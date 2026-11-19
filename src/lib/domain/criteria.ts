// Objective criteria matching. RC reports how an athlete compares to the
// coach's OWN standards — "Matches 5 of your 6 criteria" — and keeps
// "missing information" separate from "does not meet". There is no talent
// score anywhere in RC.

import { haversineMiles } from "./geo";
import { metricDef, positionMatches } from "./metrics";
import { isVerifiedLevel as isVerified, resolveMetric } from "./provenance";
import type {
  AthleteCore,
  CriterionResult,
  CriterionStatus,
  MatchResult,
  MetricObservation,
  RecruitingCriteria,
} from "./types";

export function defaultCriteria(sport = "baseball"): RecruitingCriteria {
  return {
    sport,
    gradYears: [],
    positions: [],
    includeSecondaryPosition: true,
    location: { mode: "nationwide" },
    metrics: [],
    uncommittedOnly: false,
    missingPolicy: "include",
  };
}

export function evaluateAthlete(
  athlete: AthleteCore,
  observations: MetricObservation[],
  criteria: RecruitingCriteria,
): MatchResult {
  const results: CriterionResult[] = [];
  let distanceMi: number | null = null;
  if (criteria.location.mode === "radius" && criteria.location.center && athlete.lat != null && athlete.lng != null) {
    distanceMi = haversineMiles(criteria.location.center, { lat: athlete.lat, lng: athlete.lng });
  }

  // Graduation year
  if (criteria.gradYears.length > 0) {
    results.push(
      athlete.gradYear == null
        ? crit("grad_year", "Graduation year", "required", "missing", "Graduation year not on record")
        : criteria.gradYears.includes(athlete.gradYear)
          ? crit("grad_year", "Graduation year", "required", "pass", `Class of ${athlete.gradYear}`)
          : crit(
              "grad_year",
              "Graduation year",
              "required",
              "fail",
              `Class of ${athlete.gradYear} (wanted ${criteria.gradYears.join(" or ")})`,
            ),
    );
  }

  // Position
  if (criteria.positions.length > 0) {
    const primary = criteria.positions.some((p) => positionMatches(p, athlete.primaryPosition));
    const secondary =
      criteria.includeSecondaryPosition && criteria.positions.some((p) => positionMatches(p, athlete.secondaryPosition));
    const label = `Position: ${criteria.positions.join(" / ")}`;
    if (!athlete.primaryPosition && !athlete.secondaryPosition) {
      results.push(crit("position", label, "required", "missing", "Position not on record"));
    } else if (primary) {
      results.push(crit("position", label, "required", "pass", `Primary: ${athlete.primaryPosition}`));
    } else if (secondary) {
      results.push(crit("position", label, "required", "pass", `Secondary: ${athlete.secondaryPosition}`));
    } else {
      results.push(
        crit(
          "position",
          label,
          "required",
          "fail",
          `Plays ${[athlete.primaryPosition, athlete.secondaryPosition].filter(Boolean).join(" / ")}`,
        ),
      );
    }
  }

  // Location
  const loc = criteria.location;
  if (loc.mode === "radius" && loc.center && loc.radiusMi) {
    const label = `Within ${loc.radiusMi} mi of ${loc.center.label}`;
    if (distanceMi == null) {
      results.push(crit("location", label, "required", "missing", "Hometown location not on record"));
    } else {
      results.push(
        crit(
          "location",
          label,
          "required",
          distanceMi <= loc.radiusMi ? "pass" : "fail",
          `${Math.round(distanceMi)} mi away (${[athlete.city, athlete.state].filter(Boolean).join(", ")})`,
        ),
      );
    }
  } else if (loc.mode === "states" && loc.states && loc.states.length > 0) {
    const label = `State: ${loc.states.join(", ")}`;
    if (!athlete.state) results.push(crit("location", label, "required", "missing", "State not on record"));
    else
      results.push(
        crit("location", label, "required", loc.states.includes(athlete.state) ? "pass" : "fail", athlete.state),
      );
  }

  // Metrics
  for (const m of criteria.metrics) {
    const def = metricDef(m.key);
    const opText = m.op === "gte" ? "≥" : "≤";
    const label = `${def.label} ${opText} ${def.format(m.value)}${m.verifiedOnly ? " (verified only)" : ""}`;
    const obs = observations.filter((o) => o.metricKey === m.key);
    const resolved = resolveMetric(obs);
    if (!resolved) {
      results.push(crit(`metric:${m.key}`, label, m.importance, "missing", `No ${def.label.toLowerCase()} on record`));
      continue;
    }
    const meets = (v: number) => (m.op === "gte" ? v >= m.value : v <= m.value);
    const p = resolved.primary;
    const valueText = `${def.format(p.value)} — ${p.sourceName}`;
    let status: CriterionStatus = meets(p.value) ? "pass" : "fail";
    let detail = valueText;
    if (resolved.conflict) {
      // If every reported value lands on the same side of the threshold, the
      // conflict doesn't change the answer — but we still flag it.
      const sides = new Set(resolved.observations.map((o) => meets(o.value)));
      if (sides.size > 1) {
        status = "conflict";
        detail = `Sources disagree: ${resolved.conflictDetail}`;
      } else {
        detail = `${valueText} (sources disagree, but all ${status === "pass" ? "meet" : "miss"} this standard)`;
      }
    }
    if (m.verifiedOnly && status === "pass" && !isVerified(p.verification)) {
      status = "unverified";
      detail = `${valueText} is ${p.verification.replace("_", "-")}; you asked for verified data only`;
    }
    results.push(crit(`metric:${m.key}`, label, m.importance, status, detail, p.id));
  }

  // Commitment
  if (criteria.uncommittedOnly) {
    const label = "Uncommitted (verified)";
    if (athlete.commitmentStatus === "committed") {
      results.push(crit("commitment", label, "required", "fail", "Listed as committed"));
    } else if (athlete.commitmentStatus === "uncommitted" && athlete.commitmentVerified) {
      results.push(crit("commitment", label, "required", "pass", "Verified uncommitted"));
    } else if (athlete.commitmentStatus === "uncommitted") {
      results.push(crit("commitment", label, "required", "unverified", "Listed uncommitted, not verified"));
    } else {
      results.push(crit("commitment", label, "required", "missing", "Commitment status unknown"));
    }
  }

  const total = results.length;
  const matched = results.filter((r) => r.status === "pass").length;
  const failedRequired = results.filter((r) => r.importance === "required" && r.status === "fail").length;
  const missingRequired = results.filter(
    (r) => r.importance === "required" && (r.status === "missing" || r.status === "unverified" || r.status === "conflict"),
  ).length;
  const eligible = failedRequired === 0 && (criteria.missingPolicy === "include" || missingRequired === 0);
  const missingCount = results.filter((r) => r.status === "missing").length;

  let summary = total === 0 ? "No criteria set" : `Matches ${matched} of your ${total} criteria`;
  if (missingCount > 0) summary += ` · ${missingCount} missing info`;

  return { athleteId: athlete.id, criteria: results, matched, total, failedRequired, missingRequired, eligible, summary, distanceMi };
}

function crit(
  id: string,
  label: string,
  importance: CriterionResult["importance"],
  status: CriterionStatus,
  detail: string,
  observationId?: string,
): CriterionResult {
  return { id, label, importance, status, detail, observationId };
}

/** Sort: eligible first, then fewest required gaps, then most matched, then closest. No talent ranking. */
export function sortMatches<T extends { match: MatchResult }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.match.eligible !== b.match.eligible) return a.match.eligible ? -1 : 1;
    if (a.match.failedRequired !== b.match.failedRequired) return a.match.failedRequired - b.match.failedRequired;
    if (a.match.missingRequired !== b.match.missingRequired) return a.match.missingRequired - b.match.missingRequired;
    if (a.match.matched !== b.match.matched) return b.match.matched - a.match.matched;
    return (a.match.distanceMi ?? Infinity) - (b.match.distanceMi ?? Infinity);
  });
}

/** Human-readable one-liners describing a set of criteria, for saved profiles. */
export function describeCriteria(c: RecruitingCriteria): string[] {
  const out: string[] = [];
  if (c.gradYears.length) out.push(`Class of ${c.gradYears.join(", ")}`);
  if (c.positions.length) out.push(c.positions.join(" / ") + (c.includeSecondaryPosition ? " (incl. secondary)" : ""));
  if (c.location.mode === "radius" && c.location.center) out.push(`Within ${c.location.radiusMi} mi of ${c.location.center.label}`);
  if (c.location.mode === "states" && c.location.states?.length) out.push(`In ${c.location.states.join(", ")}`);
  if (c.location.mode === "nationwide") out.push("Nationwide");
  for (const m of c.metrics) {
    const d = metricDef(m.key);
    out.push(`${d.label} ${m.op === "gte" ? "≥" : "≤"} ${d.format(m.value)}${m.importance !== "required" ? ` (${m.importance})` : ""}${m.verifiedOnly ? " · verified only" : ""}`);
  }
  if (c.uncommittedOnly) out.push("Verified uncommitted only");
  out.push(c.missingPolicy === "exclude" ? "Missing data excludes" : "Missing data flagged, not excluded");
  return out;
}
