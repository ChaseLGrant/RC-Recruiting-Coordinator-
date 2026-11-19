// Read models for the UI: search results, Evidence Mode bundles, the Daily
// Brief. All built from persisted records only.

import { Db } from "./db";
import { evaluateAthlete, sortMatches } from "./domain/criteria";
import { resolveAll, type ResolvedMetric } from "./domain/provenance";
import type { MatchResult, RecruitingCriteria } from "./domain/types";
import {
  countEventsByType,
  followedIds,
  getAthlete,
  listAthletes,
  listEvents,
  listJobRuns,
  listNotes,
  listObservations,
  listTasks,
  type AthleteRecord,
  type EventRow,
} from "./repo";
import { listApprovals, listMessages } from "./repo/approvals";

export interface SearchRow {
  athlete: AthleteRecord;
  match: MatchResult;
  metrics: Map<string, ResolvedMetric>;
  filmCount: number;
  following: boolean;
  nextGame: { starts_at: string; opponent: string | null } | null;
}

export async function searchAthletes(db: Db, orgId: string, criteria: RecruitingCriteria, opts: { includeIneligible?: boolean; limit?: number } = {}) {
  const athletes = await listAthletes(db, orgId, { gradYears: criteria.gradYears.length ? criteria.gradYears : undefined });
  const ids = athletes.map((a) => a.id);
  const obs = await listObservations(db, orgId, ids);
  const byAthlete = new Map<string, typeof obs>();
  for (const o of obs) byAthlete.set(o.athleteId, [...(byAthlete.get(o.athleteId) ?? []), o]);
  const film = await db.all<{ athlete_id: string; n: number }>("SELECT athlete_id, COUNT(*) AS n FROM film_links WHERE org_id = ? GROUP BY athlete_id", [orgId]);
  const filmBy = new Map(film.map((f) => [f.athlete_id, Number(f.n)]));
  const games = await db.all<{ athlete_id: string; starts_at: string; opponent: string | null }>(
    "SELECT athlete_id, MIN(starts_at) AS starts_at, opponent FROM games WHERE org_id = ? AND starts_at > ? AND status != 'cancelled' GROUP BY athlete_id",
    [orgId, new Date().toISOString()],
  );
  const gameBy = new Map(games.map((g) => [g.athlete_id, g]));
  const followed = await followedIds(db, orgId);

  const rows: SearchRow[] = athletes.map((a) => ({
    athlete: a,
    match: evaluateAthlete(a, byAthlete.get(a.id) ?? [], criteria),
    metrics: resolveAll(byAthlete.get(a.id) ?? []),
    filmCount: filmBy.get(a.id) ?? 0,
    following: followed.has(a.id),
    nextGame: gameBy.get(a.id) ?? null,
  }));
  const filtered = opts.includeIneligible ? rows : rows.filter((r) => r.match.eligible);
  const sorted = sortMatches(filtered);
  return {
    rows: sorted.slice(0, opts.limit ?? 200),
    totalEvaluated: rows.length,
    eligibleCount: rows.filter((r) => r.match.eligible).length,
    withCompleteVerifiedData: rows.filter((r) => r.match.eligible && r.match.criteria.every((c) => c.status === "pass")).length,
  };
}

export async function getEvidence(db: Db, orgId: string, athleteId: string) {
  const athlete = await getAthlete(db, orgId, athleteId);
  if (!athlete) return null;
  const obs = await listObservations(db, orgId, [athleteId]);
  const metrics = resolveAll(obs);
  const film = await db.all<{ id: string; url: string; title: string | null; recorded_at: string | null; checked_at: string; source_name: string }>(
    "SELECT f.*, s.name AS source_name FROM film_links f JOIN sources s ON s.id = f.source_id WHERE f.org_id = ? AND f.athlete_id = ? ORDER BY f.recorded_at DESC",
    [orgId, athleteId],
  );
  const games = await db.all<{ id: string; team_name: string | null; opponent: string | null; venue: string | null; city: string | null; state: string | null; starts_at: string; previous_starts_at: string | null; status: string; participation_confirmed: number; source_url: string | null; checked_at: string; source_name: string }>(
    "SELECT g.*, s.name AS source_name FROM games g JOIN sources s ON s.id = g.source_id WHERE g.org_id = ? AND g.athlete_id = ? ORDER BY g.starts_at",
    [orgId, athleteId],
  );
  const sources = await db.all<{ source_id: string; source_name: string; source_kind: string; match_confidence: number; match_reason: string | null; fetched_at: string; external_id: string | null }>(
    "SELECT r.source_id, s.name AS source_name, s.kind AS source_kind, r.match_confidence, r.match_reason, MAX(r.fetched_at) AS fetched_at, r.external_id FROM athlete_source_records r JOIN sources s ON s.id = r.source_id WHERE r.org_id = ? AND r.athlete_id = ? GROUP BY r.source_id, s.name, s.kind, r.match_confidence, r.match_reason, r.external_id",
    [orgId, athleteId],
  );
  const notes = await listNotes(db, orgId, athleteId);
  const messages = await listMessages(db, orgId, { athleteId });
  const following = (await followedIds(db, orgId)).has(athleteId);
  const commitmentSource = athlete.commitmentStatus !== "unknown"
    ? await db.get<{ name: string }>("SELECT s.name FROM athletes a JOIN sources s ON s.id = a.commitment_source_id WHERE a.id = ?", [athleteId])
    : undefined;

  const missing: string[] = [];
  for (const k of ["height_in", "weight_lb", "exit_velo_mph", "sixty_yd_sec"]) if (!metrics.has(k)) missing.push(k);
  if (film.length === 0) missing.push("film");
  if (athlete.gradYear == null) missing.push("grad_year");
  if (athlete.lat == null) missing.push("location");
  if (athlete.commitmentStatus === "unknown") missing.push("commitment_status");
  const conflicts = Array.from(metrics.values()).filter((m) => m.conflict);

  return { athlete, metrics, film, games, sources, notes, messages, following, missing, conflicts, commitmentSource: commitmentSource?.name ?? null };
}

export interface Brief {
  since: string;
  events: EventRow[];
  counts: Partial<Record<EventRow["type"], number>>;
  pendingApprovals: Awaited<ReturnType<typeof listApprovals>>;
  failedRuns: Awaited<ReturnType<typeof listJobRuns>>;
  recentRuns: Awaited<ReturnType<typeof listJobRuns>>;
  tasks: Awaited<ReturnType<typeof listTasks>>;
}

export async function buildBrief(db: Db, orgId: string, lastBriefAt: string | null): Promise<Brief> {
  const since = lastBriefAt ?? new Date(Date.now() - 24 * 3600_000).toISOString();
  const [events, counts, pendingApprovals, recentRuns, tasks] = await Promise.all([
    listEvents(db, orgId, since, 400),
    countEventsByType(db, orgId, since),
    listApprovals(db, orgId, ["pending", "saved"]),
    listJobRuns(db, orgId, 15),
    listTasks(db, orgId),
  ]);
  return {
    since,
    events,
    counts,
    pendingApprovals,
    recentRuns,
    failedRuns: recentRuns.filter((r) => r.status === "failed" && r.started_at > since),
    tasks,
  };
}
