// Applies the AI research updates a coach approved. Every change keeps its
// source: numbers become observations linked to the page, commitments and
// news become staff notes with the link, nothing is marked "verified".

import { newId, nowIso } from "../db";
import { metricDef } from "../domain/metrics";
import { zonedToUtc } from "../domain/time";
import { parseGameTime } from "../watch/schedule";
import { siteLabel } from "../watch/fetcher";
import { addNote, createSource, getAthlete, getOrg, listSources, logEvent, normalizePhone, normalizeXHandle, updateAthleteContact, type Ctx } from "../repo";
import type { ProposedUpdate } from "./crm-agent";

async function researchSource(ctx: Ctx, site: string) {
  const name = `${site} (via AI research)`;
  return (await listSources(ctx.db, ctx.orgId)).find((s) => s.providerId === "ai_research" && s.name === name)
    ?? (await createSource(ctx.db, ctx.orgId, { providerId: "ai_research", name, kind: "public_web", status: "connected", statusDetail: "Found by RC's research agent on public pages; approved by your staff" }));
}

export async function applyCrmUpdates(ctx: Ctx, athleteId: string, updates: ProposedUpdate[]): Promise<number> {
  const a = await getAthlete(ctx.db, ctx.orgId, athleteId);
  if (!a) return 0;
  const org = await getOrg(ctx.db, ctx.orgId);
  const name = `${a.firstName} ${a.lastName}`;
  let applied = 0;
  for (const u of updates) {
    const site = siteLabel(u.sourceUrl);
    const cite = `(${site}: ${u.sourceUrl})`;
    const d = u.details;
    switch (u.type) {
      case "stat": {
        const key = String(d.key);
        const src = await researchSource(ctx, site);
        await ctx.db.run(
          "INSERT INTO metric_observations (id, org_id, athlete_id, source_id, metric_key, value, unit, measured_at, checked_at, verification, source_url, event_name, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
          [newId(), ctx.orgId, athleteId, src.id, key, Number(d.value), metricDef(key).unit, String(d.asOf ?? "") || nowIso(), nowIso(), "unverified", u.sourceUrl, d.season ? `${d.season} season, as published on ${site}` : `As published on ${site}`, nowIso()],
        );
        break;
      }
      case "commitment": {
        const committed = d.status === "committed";
        await ctx.db.run("UPDATE athletes SET commitment_status = ?, commitment_verified = 0, updated_at = ? WHERE org_id = ? AND id = ?", [committed ? "committed" : "uncommitted", nowIso(), ctx.orgId, athleteId]);
        await addNote(ctx, athleteId, `${committed ? "Committed to" : "Decommitted from"} ${String(d.college)}${d.date ? ` (${d.date})` : ""} ${cite}`);
        break;
      }
      case "game": {
        const [y, m, day] = String(d.date).split("-").map(Number);
        const t = d.time ? parseGameTime(String(d.time)) : null;
        const src = await researchSource(ctx, site);
        await ctx.db.run(
          "INSERT INTO games (id, org_id, athlete_id, source_id, external_id, team_name, opponent, venue, starts_at, status, participation_confirmed, source_url, checked_at) VALUES (?,?,?,?,?,?,?,?,?,'scheduled',0,?,?)",
          [newId(), ctx.orgId, athleteId, src.id, `ai:${u.id}`, a.team ?? a.highSchool, String(d.opponent), d.location ? String(d.location) : null, zonedToUtc(y, m, day, t?.h ?? 12, t?.min ?? 0, org.settings.timezone), u.sourceUrl, nowIso()],
        );
        break;
      }
      case "film":
      case "social": {
        const url = String(d.url);
        await ctx.db.run("INSERT INTO athlete_links (id, org_id, athlete_id, url, kind, site, added_by, created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (org_id, athlete_id, url) DO NOTHING", [
          newId(), ctx.orgId, athleteId, url, u.type, String(d.site ?? siteLabel(url)), ctx.userId, nowIso(),
        ]);
        if (/(^|\.)(x|twitter)\.com$/.test(new URL(url).hostname.replace(/^www\./, "")) && !a.xHandle) await updateAthleteContact(ctx, athleteId, { xHandle: normalizeXHandle(url) });
        break;
      }
      case "school_change":
        await ctx.db.run("UPDATE athletes SET high_school = ?, updated_at = ? WHERE org_id = ? AND id = ?", [String(d.highSchool), nowIso(), ctx.orgId, athleteId]);
        await addNote(ctx, athleteId, `Now at ${String(d.highSchool)} ${cite}`);
        break;
      case "team_change":
        await ctx.db.run("UPDATE athletes SET team = ?, updated_at = ? WHERE org_id = ? AND id = ?", [String(d.team), nowIso(), ctx.orgId, athleteId]);
        await addNote(ctx, athleteId, `Now playing for ${String(d.team)} ${cite}`);
        break;
      case "news":
        await addNote(ctx, athleteId, `In the news: ${String(d.headline)} ${cite}`);
        break;
      case "contact":
        await updateAthleteContact(ctx, athleteId, {
          email: a.email ?? (d.email ? String(d.email) : null),
          phone: a.phone ?? normalizePhone(d.phone ? String(d.phone) : null),
        });
        break;
    }
    applied++;
  }
  if (applied) await logEvent(ctx.db, ctx.orgId, { type: "metric_updated", message: `${name}: ${applied} research update${applied > 1 ? "s" : ""} approved`, athleteId });
  return applied;
}
