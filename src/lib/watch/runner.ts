// Season stat monitor. For every public page a coach linked to a player, RC
// re-reads the page on a schedule, records any stat that changed (with the
// date and a link back), and reports the change in the Daily Brief.

import { Db, newId, nowIso } from "../db";
import { metricDef } from "../domain/metrics";
import { safeUrl } from "../domain/urls";
import { audit, authorize, createSource, getAthlete, getOrg, listSources, logEvent, type Ctx, type Source } from "../repo";
import { extractStats } from "./extract";
import { politeFetch, siteLabel } from "./fetcher";

export interface TrackedPage {
  id: string;
  athlete_id: string;
  url: string;
  site: string;
  status: string;
  status_detail: string | null;
  paused: number;
  etag: string | null;
  last_modified: string | null;
  last_fetched_at: string | null;
  last_changed_at: string | null;
  stats_found: number;
  created_at: string;
}

export async function listTrackedPages(db: Db, orgId: string, athleteId?: string): Promise<TrackedPage[]> {
  return athleteId
    ? db.all<TrackedPage>("SELECT * FROM tracked_pages WHERE org_id = ? AND athlete_id = ? ORDER BY created_at", [orgId, athleteId])
    : db.all<TrackedPage>("SELECT * FROM tracked_pages WHERE org_id = ? ORDER BY created_at", [orgId]);
}

export async function addTrackedPage(ctx: Ctx, athleteId: string, rawUrl: string): Promise<string> {
  authorize(ctx, "import_data");
  const url = safeUrl(rawUrl);
  if (!url) throw new Error("That doesn't look like a web address. Paste the full link, starting with https://");
  const a = await getAthlete(ctx.db, ctx.orgId, athleteId);
  if (!a) throw new Error("Player not found");
  const existing = await ctx.db.get<{ id: string }>("SELECT id FROM tracked_pages WHERE org_id = ? AND athlete_id = ? AND url = ?", [ctx.orgId, athleteId, url]);
  if (existing) return existing.id;
  const id = newId();
  await ctx.db.run("INSERT INTO tracked_pages (id, org_id, athlete_id, url, site, status, created_by, created_at) VALUES (?,?,?,?,?,'pending',?,?)", [
    id, ctx.orgId, athleteId, url, siteLabel(url), ctx.userId, nowIso(),
  ]);
  await audit(ctx, "track_page", "athlete", athleteId, { site: siteLabel(url) });
  return id;
}

export async function removeTrackedPage(ctx: Ctx, pageId: string) {
  authorize(ctx, "import_data");
  await ctx.db.run("DELETE FROM tracked_pages WHERE org_id = ? AND id = ?", [ctx.orgId, pageId]);
  await audit(ctx, "untrack_page", "tracked_page", pageId);
}

async function sourceFor(db: Db, orgId: string, site: string): Promise<Source> {
  const name = `${site} (public page)`;
  const existing = (await listSources(db, orgId)).find((s) => s.providerId === "public_page" && s.name === name);
  if (existing) return existing;
  return createSource(db, orgId, { providerId: "public_page", name, kind: "public_web", status: "connected", statusDetail: "Public pages your staff linked to players. Read politely; robots.txt respected." });
}

export interface PageCheckStats {
  checked: number;
  changedStats: number;
  newStats: number;
  unchanged: number;
  problems: number;
}

export async function checkTrackedPages(
  db: Db,
  orgId: string,
  opts: { runId?: string | null; force?: boolean; athleteId?: string; fetchImpl?: typeof fetch } = {},
): Promise<PageCheckStats> {
  const org = await getOrg(db, orgId);
  const out: PageCheckStats = { checked: 0, changedStats: 0, newStats: 0, unchanged: 0, problems: 0 };
  if (!org.settings.pageWatch.enabled && !opts.force) return out;
  const cutoff = new Date(Date.now() - org.settings.pageWatch.everyHours * 3600_000).toISOString();
  const pages = (await listTrackedPages(db, orgId, opts.athleteId)).filter(
    (p) => !p.paused && (opts.force || !p.last_fetched_at || p.last_fetched_at < cutoff),
  );

  for (const page of pages) {
    out.checked++;
    const athlete = await getAthlete(db, orgId, page.athlete_id);
    if (!athlete) continue;
    const name = `${athlete.firstName} ${athlete.lastName}`;
    const res = await politeFetch(page.url, { etag: page.etag, lastModified: page.last_modified }, opts.fetchImpl);

    if (res.status === "not_modified") {
      await db.run("UPDATE tracked_pages SET status = 'ok', status_detail = 'No change since last check', last_fetched_at = ? WHERE id = ?", [nowIso(), page.id]);
      await db.run("UPDATE metric_observations SET checked_at = ? WHERE org_id = ? AND athlete_id = ? AND source_url = ?", [nowIso(), orgId, page.athlete_id, page.url]);
      out.unchanged++;
      continue;
    }
    if (res.status !== "ok") {
      out.problems++;
      await db.run("UPDATE tracked_pages SET status = ?, status_detail = ?, last_fetched_at = ? WHERE id = ?", [res.status, res.detail ?? null, nowIso(), page.id]);
      // Report each new problem once, not every check.
      if (page.status !== res.status) {
        await logEvent(db, orgId, { type: "job_failed", message: `Couldn't read ${name}'s ${page.site} page: ${res.detail ?? res.status}`, athleteId: page.athlete_id, runId: opts.runId });
      }
      continue;
    }

    const ex = extractStats(res.html!);
    const source = await sourceFor(db, orgId, page.site);
    let changedHere = 0;
    for (const st of ex.stats) {
      const def = metricDef(st.key);
      const last = await db.get<{ id: string; value: number }>(
        "SELECT id, value FROM metric_observations WHERE org_id = ? AND athlete_id = ? AND source_id = ? AND metric_key = ? AND source_url = ? ORDER BY measured_at DESC, created_at DESC LIMIT 1",
        [orgId, page.athlete_id, source.id, st.key, page.url],
      );
      if (last && Number(last.value) === st.value) {
        await db.run("UPDATE metric_observations SET checked_at = ? WHERE id = ?", [nowIso(), last.id]);
        continue;
      }
      await db.run(
        "INSERT INTO metric_observations (id, org_id, athlete_id, source_id, metric_key, value, unit, measured_at, checked_at, verification, source_url, event_name, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [newId(), orgId, page.athlete_id, source.id, st.key, st.value, def.unit, nowIso(), nowIso(), "unverified", page.url, ex.season ? `${ex.season} season, as published on ${page.site}` : `As published on ${page.site}`, nowIso()],
      );
      if (last) {
        changedHere++;
        out.changedStats++;
        await logEvent(db, orgId, {
          type: "metric_updated",
          message: `${name}: ${def.label} ${def.format(Number(last.value))} → ${def.format(st.value)} (${page.site})`,
          athleteId: page.athlete_id, sourceId: source.id, runId: opts.runId,
          detail: { key: st.key, from: Number(last.value), to: st.value, url: page.url },
        });
      } else out.newStats++;
    }
    await db.run(
      "UPDATE tracked_pages SET status = ?, status_detail = ?, etag = ?, last_modified = ?, last_fetched_at = ?, last_changed_at = COALESCE(?, last_changed_at), stats_found = ? WHERE id = ?",
      [
        ex.stats.length ? "ok" : "no_stats",
        ex.stats.length ? `Read ${ex.stats.length} stats${ex.season ? ` (${ex.season})` : ""}${ex.notes.length ? `. ${ex.notes[0]}` : ""}` : ex.notes.join(" "),
        res.etag ?? null, res.lastModified ?? null, nowIso(), changedHere ? nowIso() : null, ex.stats.length, page.id,
      ],
    );
    await logEvent(db, orgId, {
      type: "source_checked",
      message: `Checked ${name}'s ${page.site} page: ${ex.stats.length ? `${ex.stats.length} stats read${changedHere ? `, ${changedHere} changed` : ", no changes"}` : "no stats found"}`,
      athleteId: page.athlete_id, sourceId: source.id, runId: opts.runId,
    });
    if (!ex.stats.length) out.problems++;
  }
  return out;
}

/** Worker/cron entry: check every organization's due pages. */
export async function runDuePageChecks(db: Db) {
  const orgs = await db.all<{ org_id: string }>("SELECT DISTINCT org_id FROM tracked_pages WHERE paused = 0");
  const results = [];
  for (const o of orgs) results.push({ orgId: o.org_id, ...(await checkTrackedPages(db, o.org_id)) });
  return results;
}
