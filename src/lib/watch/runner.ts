// Season stat monitor. For every public page a coach linked to a player, RC
// re-reads the page on a schedule, records any stat that changed (with the
// date and a link back), and reports the change in the Daily Brief.

import { Db, newId, nowIso } from "../db";
import { metricDef } from "../domain/metrics";
import { safeUrl } from "../domain/urls";
import { audit, authorize, createSource, getAthlete, getOrg, listSources, logEvent, type Ctx, type Source } from "../repo";
import { extractStats } from "./extract";
import { extractSchedule } from "./schedule";
import { extractContactInfo } from "./contact-info";
import { createApproval } from "../repo/approvals";
import { locateAthlete } from "../domain/geo";
import { orgIsActive } from "../billing/plan";
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
  gamesFound: number;
  gamesChanged: number;
  unchanged: number;
  problems: number;
}

export async function checkTrackedPages(
  db: Db,
  orgId: string,
  opts: { runId?: string | null; force?: boolean; athleteId?: string; fetchImpl?: typeof fetch; deadline?: number } = {},
): Promise<PageCheckStats> {
  const org = await getOrg(db, orgId);
  const out: PageCheckStats = { checked: 0, changedStats: 0, newStats: 0, gamesFound: 0, gamesChanged: 0, unchanged: 0, problems: 0 };
  if (!org.settings.pageWatch.enabled && !opts.force) return out;
  const cutoff = new Date(Date.now() - org.settings.pageWatch.everyHours * 3600_000).toISOString();
  // Stalest first, so a run that hits its time budget still makes fair progress.
  const pages = (await listTrackedPages(db, orgId, opts.athleteId))
    .filter((p) => !p.paused && (opts.force || !p.last_fetched_at || p.last_fetched_at < cutoff))
    .sort((a, b) => (a.last_fetched_at ?? "").localeCompare(b.last_fetched_at ?? ""));

  for (const page of pages) {
    if (opts.deadline && Date.now() > opts.deadline) break; // the rest wait for the next run
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
    // Upcoming games on the same page (team schedule pages, tournament pages).
    const sched = extractSchedule(res.html!, org.settings.timezone);
    const seenKeys = new Set<string>();
    for (const g of sched.games) {
      const ext = `page:${page.id}:${g.key}`;
      seenKeys.add(ext);
      const existing = await db.get<{ id: string; starts_at: string; status: string }>("SELECT id, starts_at, status FROM games WHERE org_id = ? AND source_id = ? AND external_id = ?", [orgId, source.id, ext]);
      const label = `${name}: ${athlete.team ?? athlete.highSchool ?? "team"} ${g.home === false ? "at" : "vs"} ${g.opponent}`;
      if (!existing) {
        const where = g.location ? locateAthlete({ city: g.location.split(",")[0], state: g.location.split(",")[1]?.trim() }) : null;
        await db.run(
          "INSERT INTO games (id, org_id, athlete_id, source_id, external_id, team_name, opponent, venue, lat, lng, starts_at, status, participation_confirmed, source_url, checked_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)",
          [newId(), orgId, page.athlete_id, source.id, ext, athlete.team ?? athlete.highSchool ?? null, g.opponent, g.location ?? (g.home ? "Home" : null), where?.lat ?? null, where?.lng ?? null, g.startsAt, g.status, page.url, nowIso()],
        );
        out.gamesFound++;
        if (g.status === "scheduled") await logEvent(db, orgId, { type: "game_identified", message: `${label} on ${g.startsAt.slice(0, 10)} (${page.site})`, athleteId: page.athlete_id, sourceId: source.id, runId: opts.runId });
      } else if (existing.starts_at !== g.startsAt || existing.status !== g.status) {
        await db.run("UPDATE games SET previous_starts_at = ?, starts_at = ?, status = ?, checked_at = ? WHERE id = ?", [existing.starts_at, g.startsAt, g.status === "cancelled" ? "cancelled" : "changed", nowIso(), existing.id]);
        out.gamesChanged++;
        await logEvent(db, orgId, { type: "schedule_changed", message: `${label}: ${g.status === "cancelled" ? "canceled or postponed" : "time changed"} (${page.site})`, athleteId: page.athlete_id, sourceId: source.id, runId: opts.runId });
      } else {
        await db.run("UPDATE games SET checked_at = ? WHERE id = ?", [nowIso(), existing.id]);
      }
    }
    // Future games from this page that disappeared from it: flag, don't silently keep them.
    if (sched.games.length > 0) {
      const listed = await db.all<{ id: string; external_id: string; opponent: string | null }>(
        "SELECT id, external_id, opponent FROM games WHERE org_id = ? AND source_id = ? AND source_url = ? AND athlete_id = ? AND starts_at > ? AND status != 'cancelled'",
        [orgId, source.id, page.url, page.athlete_id, nowIso()],
      );
      for (const gm of listed.filter((x) => !seenKeys.has(x.external_id))) {
        await db.run("UPDATE games SET status = 'cancelled', checked_at = ? WHERE id = ?", [nowIso(), gm.id]);
        out.gamesChanged++;
        await logEvent(db, orgId, { type: "schedule_changed", message: `${name}: game vs ${gm.opponent ?? "TBD"} is no longer on the schedule (${page.site})`, athleteId: page.athlete_id, sourceId: source.id, runId: opts.runId });
      }
    }
    // Player's own contact details listed on the page → suggest to the coach (never saved silently).
    if (!athlete.optedOut) {
      const ci = extractContactInfo(res.html!, page.url);
      const fresh = {
        email: ci.email && ci.email !== athlete.email ? ci.email : null,
        phone: ci.phone && ci.phone !== athlete.phone ? ci.phone : null,
        xHandle: ci.xHandle && ci.xHandle !== athlete.xHandle ? ci.xHandle : null,
      };
      const parts = [fresh.email && `email ${fresh.email}`, fresh.phone && `phone ${fresh.phone}`, fresh.xHandle && `X @${fresh.xHandle}`].filter(Boolean);
      if (parts.length) {
        await createApproval(db, orgId, {
          kind: "contact_found",
          title: `Contact info for ${name}`,
          summary: `${name}'s ${page.site} page lists ${parts.join(", ")}. Save it to their profile? Your compliance settings still apply before anyone is contacted.`,
          payload: { ...fresh, url: page.url, site: page.site },
          dedupeKey: `contact:${page.athlete_id}:${fresh.email ?? ""}:${fresh.phone ?? ""}:${fresh.xHandle ?? ""}`,
          athleteId: page.athlete_id,
          runId: opts.runId,
        });
      }
    }
    const found = ex.stats.length > 0 || sched.games.length > 0;
    const summary = [ex.stats.length ? `${ex.stats.length} stats${ex.season ? ` (${ex.season})` : ""}` : "", sched.games.length ? `${sched.games.length} upcoming games` : ""].filter(Boolean).join(" and ");
    await db.run(
      "UPDATE tracked_pages SET status = ?, status_detail = ?, etag = ?, last_modified = ?, last_fetched_at = ?, last_changed_at = COALESCE(?, last_changed_at), stats_found = ? WHERE id = ?",
      [
        found ? "ok" : "no_stats",
        found ? `Read ${summary}` : "No stats or upcoming games found on this page. It may need a login, load data with JavaScript, or use a layout RC doesn't read yet.",
        res.etag ?? null, res.lastModified ?? null, nowIso(), changedHere ? nowIso() : null, ex.stats.length, page.id,
      ],
    );
    await logEvent(db, orgId, {
      type: "source_checked",
      message: `Checked ${name}'s ${page.site} page: ${found ? `${summary}${changedHere ? `, ${changedHere} stats changed` : ""}` : "nothing readable found"}`,
      athleteId: page.athlete_id, sourceId: source.id, runId: opts.runId,
    });
    if (!found) out.problems++;
  }
  return out;
}

/** Worker/cron entry: check every organization's due pages. */
export async function runDuePageChecks(db: Db, budgetMs = Number(process.env.RC_PAGE_CHECK_BUDGET_MS ?? 40_000)) {
  const deadline = Date.now() + budgetMs;
  const orgs = await db.all<{ org_id: string }>("SELECT DISTINCT org_id FROM tracked_pages WHERE paused = 0");
  const results = [];
  for (const o of orgs) {
    if (Date.now() > deadline) break;
    if (!(await orgIsActive(db, o.org_id))) continue;
    results.push({ orgId: o.org_id, ...(await checkTrackedPages(db, o.org_id, { deadline })) });
  }
  return results;
}
