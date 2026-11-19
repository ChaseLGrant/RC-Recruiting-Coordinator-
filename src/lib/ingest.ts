// Ingestion: turns authorized provider records into athletes, sourced metric
// observations, film links and games. Every write is attributed to a source
// and every meaningful change is recorded as an event (which is what the
// Daily Brief and the Impact page read — nothing is simulated).

import { Db, newId, nowIso } from "./db";
import { locateAthlete, normalizeState } from "./domain/geo";
import { decideIdentity, normalizeName } from "./domain/identity";
import { metricDef } from "./domain/metrics";
import { isVerifiedLevel, resolveMetric } from "./domain/provenance";
import { athleteFromRow, listObservations, logEvent, Source, type AthleteRecord } from "./repo";
import { createApproval } from "./repo/approvals";
import type { ProviderAthleteRecord } from "./providers/types";

export interface IngestStats {
  records: number;
  athletesCreated: number;
  athletesMatched: number;
  possibleDuplicates: number;
  metricsAdded: number;
  metricsRechecked: number;
  conflicts: number;
  filmAdded: number;
  gamesAdded: number;
  gamesChanged: number;
  skipped: number;
}

export function emptyStats(): IngestStats {
  return { records: 0, athletesCreated: 0, athletesMatched: 0, possibleDuplicates: 0, metricsAdded: 0, metricsRechecked: 0, conflicts: 0, filmAdded: 0, gamesAdded: 0, gamesChanged: 0, skipped: 0 };
}

export async function ingestRecords(
  db: Db,
  orgId: string,
  source: Source,
  records: ProviderAthleteRecord[],
  opts: { isDemo: boolean; runId?: string | null; sport: string; createMissing?: boolean },
): Promise<IngestStats> {
  const stats = emptyStats();
  for (const rec of records) {
    stats.records++;
    await db.tx(async (tdb) => {
      const athleteId = await resolveAthlete(tdb, orgId, source, rec, opts, stats);
      if (!athleteId) {
        stats.skipped++;
        return;
      }
      await ingestMetrics(tdb, orgId, source, athleteId, rec, opts.runId ?? null, stats);
      await ingestFilm(tdb, orgId, source, athleteId, rec, stats);
      await ingestGames(tdb, orgId, source, athleteId, rec, opts.runId ?? null, stats);
    });
  }
  return stats;
}

async function resolveAthlete(
  db: Db,
  orgId: string,
  source: Source,
  rec: ProviderAthleteRecord,
  opts: { isDemo: boolean; runId?: string | null; sport: string; createMissing?: boolean },
  stats: IngestStats,
): Promise<string | null> {
  const now = nowIso();
  // 1) Same source + same external id → same athlete, no guessing needed.
  if (rec.externalId) {
    const linked = await db.get<{ athlete_id: string }>(
      "SELECT athlete_id FROM athlete_source_records WHERE org_id = ? AND source_id = ? AND external_id = ?",
      [orgId, source.id, rec.externalId],
    );
    if (linked && (await db.get("SELECT id FROM athletes WHERE id = ? AND org_id = ?", [linked.athlete_id, orgId]))) {
      await db.run("UPDATE athlete_source_records SET raw_json = ?, fetched_at = ? WHERE org_id = ? AND source_id = ? AND external_id = ?", [
        JSON.stringify(rec), now, orgId, source.id, rec.externalId,
      ]);
      await updateFacts(db, orgId, linked.athlete_id, rec, source);
      stats.athletesMatched++;
      await logEvent(db, orgId, { type: "athlete_researched", message: `Re-checked ${rec.firstName} ${rec.lastName} in ${source.name}`, athleteId: linked.athlete_id, sourceId: source.id, runId: opts.runId });
      return linked.athlete_id;
    }
  }

  // 2) Identity matching against existing athletes with the same last name.
  const candidates = (
    await db.all("SELECT * FROM athletes WHERE org_id = ? AND LOWER(last_name) = LOWER(?)", [orgId, rec.lastName.trim()])
  )
    .map(athleteFromRow)
    .filter((a) => normalizeName(a.lastName) === normalizeName(rec.lastName));
  const decision = decideIdentity(
    { firstName: rec.firstName, lastName: rec.lastName, gradYear: rec.gradYear, highSchool: rec.highSchool, city: rec.city, state: normalizeState(rec.state), email: rec.email },
    candidates,
  );

  let athleteId: string;
  let confidence = 1;
  let reason = "New athlete";
  if (decision.kind === "merge") {
    athleteId = decision.match.candidate.id;
    confidence = decision.match.score;
    reason = decision.match.reasons.join(", ");
    await updateFacts(db, orgId, athleteId, rec, source);
    stats.athletesMatched++;
  } else {
    if (opts.createMissing === false) return null;
    athleteId = await insertAthlete(db, orgId, rec, opts);
    stats.athletesCreated++;
    if (decision.kind === "review") {
      const top = decision.matches[0];
      confidence = top.score;
      reason = `Possible duplicate of existing record (${top.reasons.join(", ")})`;
      await db.run("UPDATE athletes SET identity_confidence = ? WHERE id = ?", [top.score, athleteId]);
      stats.possibleDuplicates++;
      await createApproval(db, orgId, {
        kind: "data_conflict",
        title: `Possible duplicate: ${rec.firstName} ${rec.lastName}`,
        summary: `${source.name} has a record that may be the same athlete as an existing ${top.candidate.firstName} ${top.candidate.lastName} (${top.candidate.highSchool ?? "school unknown"}). Match evidence: ${top.reasons.join(", ")}. Approve to merge; reject to keep them separate.`,
        payload: { type: "possible_duplicate", keepId: top.candidate.id, dropId: athleteId, score: top.score, reasons: top.reasons },
        dedupeKey: `dup:${top.candidate.id}:${athleteId}`,
        athleteId: top.candidate.id,
        runId: opts.runId,
      });
      await logEvent(db, orgId, { type: "conflict_detected", message: `Possible duplicate flagged: ${rec.firstName} ${rec.lastName}`, athleteId, sourceId: source.id, runId: opts.runId });
    }
  }

  await db.run(
    "INSERT INTO athlete_source_records (id, org_id, athlete_id, source_id, external_id, raw_json, match_confidence, match_reason, fetched_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [newId(), orgId, athleteId, source.id, rec.externalId ?? null, JSON.stringify(rec), confidence, reason, now],
  );
  await logEvent(db, orgId, { type: "athlete_researched", message: `Researched ${rec.firstName} ${rec.lastName} from ${source.name}`, athleteId, sourceId: source.id, runId: opts.runId });
  return athleteId;
}

async function insertAthlete(db: Db, orgId: string, rec: ProviderAthleteRecord, opts: { isDemo: boolean; sport: string }): Promise<string> {
  const id = newId();
  const now = nowIso();
  const state = normalizeState(rec.state);
  const geo = locateAthlete({ zip: rec.zip, city: rec.city, state });
  await db.run(
    `INSERT INTO athletes (id, org_id, first_name, last_name, grad_year, sport, primary_position, secondary_position, bats, throws, high_school, team, city, state, zip, lat, lng, geo_precision, identity_confidence, commitment_status, commitment_verified, email, guardian_email, is_demo, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?)`,
    [
      id, orgId, rec.firstName.trim(), rec.lastName.trim(), rec.gradYear, rec.sport ?? opts.sport, rec.primaryPosition ?? null, rec.secondaryPosition ?? null,
      rec.bats ?? null, rec.throws ?? null, rec.highSchool ?? null, rec.team ?? null, rec.city ?? null, state, rec.zip ?? null,
      geo?.lat ?? null, geo?.lng ?? null, geo?.precision ?? null, rec.commitmentStatus ?? "unknown", rec.commitmentVerified ? 1 : 0,
      rec.email ?? null, rec.guardianEmail ?? null, opts.isDemo ? 1 : 0, now, now,
    ],
  );
  return id;
}

/** Fill in facts we didn't have. Never overwrite existing values silently. */
async function updateFacts(db: Db, orgId: string, athleteId: string, rec: ProviderAthleteRecord, source: Source) {
  const row = await db.get("SELECT * FROM athletes WHERE id = ? AND org_id = ?", [athleteId, orgId]);
  if (!row) return;
  const a = athleteFromRow(row);
  const set: Record<string, string | number | null> = {};
  const fill = (col: string, current: unknown, next: unknown) => {
    if ((current == null || current === "") && next != null && next !== "") set[col] = next as string | number;
  };
  fill("primary_position", a.primaryPosition, rec.primaryPosition);
  fill("secondary_position", a.secondaryPosition, rec.secondaryPosition);
  fill("high_school", a.highSchool, rec.highSchool);
  fill("team", a.team, rec.team);
  fill("city", a.city, rec.city);
  fill("state", a.state, normalizeState(rec.state));
  fill("zip", a.zip, rec.zip);
  fill("email", a.email, rec.email);
  fill("guardian_email", a.guardianEmail, rec.guardianEmail);
  fill("grad_year", a.gradYear, rec.gradYear);
  if (a.lat == null) {
    const geo = locateAthlete({ zip: rec.zip ?? a.zip, city: rec.city ?? a.city, state: normalizeState(rec.state) ?? a.state });
    if (geo) Object.assign(set, { lat: geo.lat, lng: geo.lng, geo_precision: geo.precision });
  }
  // Commitment status: a verified status from a source beats an unverified one.
  if (rec.commitmentStatus && rec.commitmentStatus !== "unknown") {
    if (a.commitmentStatus === "unknown" || (!a.commitmentVerified && rec.commitmentVerified)) {
      Object.assign(set, { commitment_status: rec.commitmentStatus, commitment_verified: rec.commitmentVerified ? 1 : 0, commitment_source_id: source.id });
    }
  }
  const cols = Object.keys(set);
  if (cols.length === 0) return;
  await db.run(`UPDATE athletes SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE id = ? AND org_id = ?`, [
    ...cols.map((c) => set[c]), nowIso(), athleteId, orgId,
  ]);
}

async function ingestMetrics(db: Db, orgId: string, source: Source, athleteId: string, rec: ProviderAthleteRecord, runId: string | null, stats: IngestStats) {
  const athleteName = `${rec.firstName} ${rec.lastName}`;
  for (const m of rec.metrics ?? []) {
    if (!Number.isFinite(m.value)) continue;
    const def = metricDef(m.key);
    const now = nowIso();
    const existing = await db.get<{ id: string; value: number }>(
      "SELECT id, value FROM metric_observations WHERE org_id = ? AND athlete_id = ? AND source_id = ? AND metric_key = ? AND COALESCE(measured_at, '') = ?",
      [orgId, athleteId, source.id, m.key, m.measuredAt ?? ""],
    );
    if (existing && Number(existing.value) === m.value) {
      await db.run("UPDATE metric_observations SET checked_at = ? WHERE id = ?", [now, existing.id]);
      stats.metricsRechecked++;
      continue;
    }
    const prior = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM metric_observations WHERE org_id = ? AND athlete_id = ? AND metric_key = ?", [orgId, athleteId, m.key]);
    const before = resolveMetric(await listObservations(db, orgId, [athleteId]).then((o) => o.filter((x) => x.metricKey === m.key)));
    if (existing) {
      // Same source, same measurement date, different value: the source corrected itself.
      await db.run("UPDATE metric_observations SET value = ?, checked_at = ?, verification = ? WHERE id = ?", [m.value, now, m.verification, existing.id]);
    } else {
      await db.run(
        "INSERT INTO metric_observations (id, org_id, athlete_id, source_id, metric_key, value, unit, measured_at, checked_at, verification, source_url, event_name, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [newId(), orgId, athleteId, source.id, m.key, m.value, def.unit, m.measuredAt, now, m.verification, m.sourceUrl ?? null, m.eventName ?? null, now],
      );
    }
    stats.metricsAdded++;
    const after = resolveMetric((await listObservations(db, orgId, [athleteId])).filter((x) => x.metricKey === m.key));
    if (Number(prior?.n ?? 0) > 0 && before && after && before.primary.value !== after.primary.value) {
      await logEvent(db, orgId, {
        type: "metric_updated",
        message: `${athleteName}: ${def.label} ${def.format(before.primary.value)} → ${def.format(after.primary.value)} (${source.name})`,
        athleteId, sourceId: source.id, runId,
        detail: { key: m.key, from: before.primary.value, to: after.primary.value, verification: m.verification, measuredAt: m.measuredAt },
      });
    }
    if (isVerifiedLevel(m.verification)) {
      await logEvent(db, orgId, { type: "metric_verified", message: `${athleteName}: ${def.label} ${def.format(m.value)} recorded as ${m.verification.replace("_", " ")} (${source.name})`, athleteId, sourceId: source.id, runId, detail: { key: m.key } });
    }
    if (after?.conflict && !before?.conflict) {
      stats.conflicts++;
      await logEvent(db, orgId, { type: "conflict_detected", message: `${athleteName}: sources disagree on ${def.label.toLowerCase()}`, athleteId, sourceId: source.id, runId });
      await createApproval(db, orgId, {
        kind: "data_conflict",
        title: `Conflicting ${def.label.toLowerCase()}: ${athleteName}`,
        summary: `${after.conflictDetail}. RC shows every value with its source and date rather than choosing one. Approve to acknowledge.`,
        payload: { type: "metric_conflict", metricKey: m.key, observations: after.observations.map((o) => ({ value: o.value, source: o.sourceName, measuredAt: o.measuredAt, verification: o.verification })) },
        dedupeKey: `conflict:${athleteId}:${m.key}`,
        athleteId,
        runId,
      });
    }
  }
}

async function ingestFilm(db: Db, orgId: string, source: Source, athleteId: string, rec: ProviderAthleteRecord, stats: IngestStats) {
  for (const f of rec.film ?? []) {
    if (!/^https?:\/\//i.test(f.url)) continue;
    const existing = await db.get<{ id: string }>("SELECT id FROM film_links WHERE org_id = ? AND athlete_id = ? AND url = ?", [orgId, athleteId, f.url]);
    if (existing) {
      await db.run("UPDATE film_links SET checked_at = ? WHERE id = ?", [nowIso(), existing.id]);
      continue;
    }
    await db.run("INSERT INTO film_links (id, org_id, athlete_id, source_id, url, title, recorded_at, checked_at) VALUES (?,?,?,?,?,?,?,?)", [
      newId(), orgId, athleteId, source.id, f.url, f.title ?? null, f.recordedAt ?? null, nowIso(),
    ]);
    stats.filmAdded++;
  }
}

async function ingestGames(db: Db, orgId: string, source: Source, athleteId: string, rec: ProviderAthleteRecord, runId: string | null, stats: IngestStats) {
  const name = `${rec.firstName} ${rec.lastName}`;
  for (const g of rec.games ?? []) {
    const startsAt = new Date(g.startsAt).toISOString();
    const existing = g.externalId
      ? await db.get<{ id: string; starts_at: string; status: string }>("SELECT id, starts_at, status FROM games WHERE org_id = ? AND source_id = ? AND external_id = ?", [orgId, source.id, g.externalId])
      : await db.get<{ id: string; starts_at: string; status: string }>(
          "SELECT id, starts_at, status FROM games WHERE org_id = ? AND athlete_id = ? AND starts_at = ? AND COALESCE(opponent,'') = ?",
          [orgId, athleteId, startsAt, g.opponent ?? ""],
        );
    const status = g.status ?? "scheduled";
    if (existing) {
      if (existing.starts_at !== startsAt || existing.status !== status) {
        await db.run("UPDATE games SET previous_starts_at = ?, starts_at = ?, status = ?, checked_at = ? WHERE id = ?", [
          existing.starts_at, startsAt, status === "cancelled" ? "cancelled" : "changed", nowIso(), existing.id,
        ]);
        stats.gamesChanged++;
        await logEvent(db, orgId, {
          type: "schedule_changed",
          message: `${name}: game vs ${g.opponent ?? "TBD"} ${status === "cancelled" ? "cancelled" : `moved from ${existing.starts_at.slice(0, 10)} to ${startsAt.slice(0, 10)}`} (${source.name})`,
          athleteId, sourceId: source.id, runId,
        });
      } else {
        await db.run("UPDATE games SET checked_at = ? WHERE id = ?", [nowIso(), existing.id]);
      }
      continue;
    }
    const geo = locateAthlete({ city: g.city, state: normalizeState(g.state) });
    await db.run(
      "INSERT INTO games (id, org_id, athlete_id, source_id, external_id, team_name, opponent, venue, city, state, lat, lng, starts_at, status, participation_confirmed, source_url, checked_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [newId(), orgId, athleteId, source.id, g.externalId ?? null, g.teamName ?? rec.team ?? null, g.opponent ?? null, g.venue ?? null, g.city ?? null, normalizeState(g.state), geo?.lat ?? null, geo?.lng ?? null, startsAt, status, g.participationConfirmed ? 1 : 0, g.sourceUrl ?? null, nowIso()],
    );
    stats.gamesAdded++;
    if (new Date(startsAt) > new Date()) {
      await logEvent(db, orgId, { type: "game_identified", message: `${name}: ${g.teamName ?? "team"} vs ${g.opponent ?? "TBD"} on ${startsAt.slice(0, 10)} (${source.name})`, athleteId, sourceId: source.id, runId });
    }
  }
}

export type { AthleteRecord };
