// The recruiting staff. A mission run:
//   1. checks every connected authorized source (Scouting Research Assistant)
//   2. evaluates all athletes against the coach's saved standards (Talent Discovery)
//   3. records upcoming games for matched/followed athletes (Game Tracking)
//   4. organizes follow-up tasks + itinerary suggestions (Recruiting Operations)
//   5. prepares a camp invitation list for coach approval (Camp Recruiting)
// Everything it does is written to job_runs + events, which the Executive
// Assistant (Daily Brief) reads. Failures are recorded, never hidden.

import { Db, newId, nowIso } from "../db";
import { evaluateAthlete } from "../domain/criteria";
import { metricDef } from "../domain/metrics";
import { getProvider } from "../providers/registry";
import {
  followedIds,
  getMission,
  getOrg,
  getProfile,
  listAthletes,
  listObservations,
  listSources,
  logEvent,
  nextRunAfter,
  updateSourceStatus,
  createTask,
  type Mission,
  type Org,
} from "../repo";
import { createApproval } from "../repo/approvals";
import { emptyStats, ingestRecords, type IngestStats } from "../ingest";

export interface SyncResult {
  sourcesChecked: number;
  sourcesFailed: number;
  ingest: IngestStats;
}

/** Pull updates from every connected source that supports sync. */
export async function syncSources(db: Db, org: Org, runId: string | null): Promise<SyncResult> {
  const out: SyncResult = { sourcesChecked: 0, sourcesFailed: 0, ingest: emptyStats() };
  for (const source of await listSources(db, org.id)) {
    const provider = getProvider(source.providerId);
    if (!provider?.supportsSync || !provider.sync) continue;
    const status = provider.status(process.env, org);
    if (status.status !== "connected") {
      await updateSourceStatus(db, org.id, source.id, status.status, status.detail);
      continue;
    }
    try {
      const { records, config } = await provider.sync({ config: source.config, isDemo: org.isDemo, now: new Date() });
      const stats = await ingestRecords(db, org.id, source, records, { isDemo: org.isDemo, runId, sport: org.sport });
      for (const k of Object.keys(stats) as (keyof IngestStats)[]) out.ingest[k] += stats[k];
      await updateSourceStatus(db, org.id, source.id, "connected", `Last sync: ${records.length} records`, config ?? source.config);
      out.sourcesChecked++;
      await logEvent(db, org.id, {
        type: "source_checked",
        message: `Checked ${source.name}: ${records.length} records, ${stats.athletesCreated} new athletes, ${stats.metricsAdded} new measurements, ${stats.gamesAdded} new games`,
        sourceId: source.id, runId, detail: stats,
      });
    } catch (e) {
      out.sourcesFailed++;
      const msg = e instanceof Error ? e.message : String(e);
      await updateSourceStatus(db, org.id, source.id, "error", msg);
      await logEvent(db, org.id, { type: "job_failed", message: `Could not check ${source.name}: ${msg}`, sourceId: source.id, runId });
    }
  }
  return out;
}

export interface MissionRunStats {
  sourcesChecked: number;
  sourcesFailed: number;
  athletesEvaluated: number;
  eligible: number;
  newMatches: number;
  upcomingGames: number;
  tasksCreated: number;
  campListSize: number;
  ingest: IngestStats;
}

export async function runMission(db: Db, orgId: string, missionId: string, trigger: "schedule" | "manual" | "cron"): Promise<{ runId: string; status: "succeeded" | "failed"; stats?: MissionRunStats; error?: string }> {
  const mission = await getMission(db, orgId, missionId);
  if (!mission) throw new Error("Mission not found");
  const runId = newId();
  await db.run("INSERT INTO job_runs (id, org_id, mission_id, kind, status, trigger, started_at) VALUES (?,?,?,?,?,?,?)", [
    runId, orgId, missionId, "mission", "running", trigger, nowIso(),
  ]);
  // Advance the schedule first so a crashing mission can't hot-loop.
  await db.run("UPDATE missions SET last_run_at = ?, next_run_at = ? WHERE id = ? AND org_id = ?", [
    nowIso(), mission.schedule === "manual" ? null : nextRunAfter(mission.schedule), missionId, orgId,
  ]);
  try {
    const stats = await executeMission(db, orgId, mission, runId);
    await db.run("UPDATE job_runs SET status = 'succeeded', finished_at = ?, stats_json = ? WHERE id = ?", [nowIso(), JSON.stringify(stats), runId]);
    return { runId, status: "succeeded", stats };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.run("UPDATE job_runs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?", [nowIso(), msg, runId]);
    await logEvent(db, orgId, { type: "job_failed", message: `Mission "${mission.name}" failed: ${msg}`, runId });
    return { runId, status: "failed", error: msg };
  }
}

async function executeMission(db: Db, orgId: string, mission: Mission, runId: string): Promise<MissionRunStats> {
  const org = await getOrg(db, orgId);
  const profile = await getProfile(db, orgId, mission.profileId);
  if (!profile) throw new Error("The recruiting profile for this mission was deleted");

  const sync = await syncSources(db, org, runId);

  // Talent Discovery — evaluate everyone against the coach's own standards.
  const c = profile.criteria;
  const athletes = await listAthletes(db, orgId, { gradYears: c.gradYears.length ? c.gradYears : undefined });
  const obs = await listObservations(db, orgId, athletes.map((a) => a.id));
  const byAthlete = new Map<string, typeof obs>();
  for (const o of obs) byAthlete.set(o.athleteId, [...(byAthlete.get(o.athleteId) ?? []), o]);
  const followed = await followedIds(db, orgId);

  let eligible = 0;
  let newMatches = 0;
  const eligibleIds: string[] = [];
  const now = nowIso();
  for (const a of athletes) {
    const m = evaluateAthlete(a, byAthlete.get(a.id) ?? [], c);
    const prev = await db.get<{ eligible: number }>("SELECT eligible FROM mission_matches WHERE mission_id = ? AND athlete_id = ?", [mission.id, a.id]);
    if (prev) {
      await db.run("UPDATE mission_matches SET last_evaluated_at = ?, eligible = ?, result_json = ? WHERE mission_id = ? AND athlete_id = ?", [
        now, m.eligible ? 1 : 0, JSON.stringify(m), mission.id, a.id,
      ]);
    } else if (m.eligible) {
      await db.run("INSERT INTO mission_matches (id, org_id, mission_id, athlete_id, first_matched_at, last_evaluated_at, eligible, result_json) VALUES (?,?,?,?,?,?,1,?)", [
        newId(), orgId, mission.id, a.id, now, now, JSON.stringify(m),
      ]);
    }
    if (!m.eligible) continue;
    eligible++;
    eligibleIds.push(a.id);
    const becameEligible = !prev || !Number(prev.eligible);
    if (becameEligible && !followed.has(a.id)) {
      newMatches++;
      const gaps = m.criteria.filter((x) => x.status !== "pass").map((x) => `${x.label}: ${x.status}`);
      await logEvent(db, orgId, {
        type: "athlete_discovered",
        message: `${a.firstName} ${a.lastName} (${a.primaryPosition ?? "?"}, ${a.gradYear ?? "?"}) — ${m.summary} for "${profile.name}"`,
        athleteId: a.id, runId, detail: { missionId: mission.id, matched: m.matched, total: m.total },
      });
      await createApproval(db, orgId, {
        kind: "prospect",
        title: `${a.firstName} ${a.lastName} meets your "${profile.name}" standards`,
        summary: `${m.summary}.${m.distanceMi != null ? ` ${Math.round(m.distanceMi)} mi from ${c.location.center?.label}.` : ""}${gaps.length ? ` Not yet confirmed: ${gaps.join("; ")}.` : ""} Approve to add to Following.`,
        payload: { missionId: mission.id, match: m },
        dedupeKey: `prospect:${mission.id}:${a.id}`,
        athleteId: a.id,
        runId,
      });
    }
  }

  // Game Tracking — upcoming games for followed + matched athletes.
  let upcomingGames = 0;
  let tasksCreated = 0;
  const watchIds = Array.from(new Set([...eligibleIds, ...followed]));
  if (mission.actions.monitorGames && watchIds.length) {
    const horizon = new Date(Date.now() + 21 * 86_400_000).toISOString();
    const games = await db.all<{ id: string; athlete_id: string; opponent: string | null; team_name: string | null; starts_at: string; city: string | null; state: string | null; participation_confirmed: number }>(
      `SELECT * FROM games WHERE org_id = ? AND starts_at > ? AND starts_at < ? AND status != 'cancelled' AND athlete_id IN (${watchIds.map(() => "?").join(",")}) ORDER BY starts_at`,
      [orgId, nowIso(), horizon, ...watchIds],
    );
    upcomingGames = games.length;
    const names = new Map(athletes.map((a) => [a.id, `${a.firstName} ${a.lastName}`]));
    // Recruiting Operations — scouting tasks for followed athletes only.
    for (const g of games.filter((x) => followed.has(x.athlete_id)).slice(0, 15)) {
      const created = await createTask(db, orgId, {
        title: `Scouting opportunity: ${names.get(g.athlete_id) ?? "prospect"} — ${g.team_name ?? "team"} vs ${g.opponent ?? "TBD"}, ${g.starts_at.slice(0, 10)}${g.city ? ` (${g.city}, ${g.state})` : ""}`,
        athleteId: g.athlete_id, dueAt: g.starts_at, origin: "mission", runId,
      });
      if (created) tasksCreated++;
    }
    // Itinerary suggestion — cluster the next 14 days of followed athletes' games.
    const twoWeeks = new Date(Date.now() + 14 * 86_400_000).toISOString();
    const soon = games.filter((g) => followed.has(g.athlete_id) && g.starts_at < twoWeeks);
    if (soon.length >= 2) {
      const weekKey = new Date().toISOString().slice(0, 10);
      await createApproval(db, orgId, {
        kind: "itinerary",
        title: `Scouting itinerary: ${soon.length} games of followed prospects in the next 14 days`,
        summary: soon.slice(0, 6).map((g) => `${g.starts_at.slice(0, 10)} ${names.get(g.athlete_id)} vs ${g.opponent ?? "TBD"}${g.city ? ` (${g.city})` : ""}`).join("; ") + ". Participation is not confirmed by any source.",
        payload: { games: soon.map((g) => ({ gameId: g.id, athleteId: g.athlete_id, startsAt: g.starts_at, opponent: g.opponent, city: g.city, state: g.state })) },
        dedupeKey: `itinerary:${mission.id}:${weekKey}`,
        runId,
      });
    }
  }

  // Camp Recruiting — build the invite list; drafts are created only when the coach approves the list.
  let campListSize = 0;
  if (mission.actions.prepareCampInvites && mission.actions.campId) {
    const camp = await db.get<{ id: string; name: string; starts_at: string }>("SELECT * FROM camps WHERE org_id = ? AND id = ?", [orgId, mission.actions.campId]);
    if (camp && camp.starts_at > nowIso()) {
      const fresh: string[] = [];
      for (const id of eligibleIds) {
        const r = await db.run("INSERT INTO camp_targets (id, org_id, camp_id, athlete_id, status, created_at, updated_at) VALUES (?,?,?,?,'targeted',?,?) ON CONFLICT (camp_id, athlete_id) DO NOTHING", [
          newId(), orgId, camp.id, id, nowIso(), nowIso(),
        ]);
        if (r.changes > 0) fresh.push(id);
      }
      campListSize = fresh.length;
      if (fresh.length) {
        const names = athletes.filter((a) => fresh.includes(a.id)).map((a) => `${a.firstName} ${a.lastName}`);
        await createApproval(db, orgId, {
          kind: "camp_list",
          title: `Camp invitation list: ${fresh.length} prospects for ${camp.name}`,
          summary: `${names.slice(0, 8).join(", ")}${names.length > 8 ? ` and ${names.length - 8} more` : ""} meet "${profile.name}". Approving prepares personalized invitations and runs each through compliance checks. Nothing is sent automatically.`,
          payload: { campId: camp.id, athleteIds: fresh, missionId: mission.id },
          runId,
        });
      }
    }
  }

  return {
    sourcesChecked: sync.sourcesChecked,
    sourcesFailed: sync.sourcesFailed,
    athletesEvaluated: athletes.length,
    eligible,
    newMatches,
    upcomingGames,
    tasksCreated,
    campListSize,
    ingest: sync.ingest,
  };
}

/** Run every mission that is due. Used by the worker process and /api/cron. */
export async function runDueMissions(db: Db, trigger: "schedule" | "cron" = "schedule") {
  const due = await db.all<{ id: string; org_id: string }>("SELECT id, org_id FROM missions WHERE active = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at LIMIT 25", [nowIso()]);
  const results = [];
  for (const m of due) results.push(await runMission(db, m.org_id, m.id, trigger));
  return results;
}

export function describeIngest(s: IngestStats): string {
  return `${s.records} records · ${s.athletesCreated} new athletes · ${s.athletesMatched} matched · ${s.metricsAdded} measurements · ${s.gamesAdded} games${s.conflicts ? ` · ${s.conflicts} conflicts` : ""}${s.possibleDuplicates ? ` · ${s.possibleDuplicates} possible duplicates` : ""}`;
}

export { metricDef };
