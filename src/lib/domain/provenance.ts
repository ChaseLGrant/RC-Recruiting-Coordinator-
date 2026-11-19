// Evidence Mode core: given every observation RC has for an athlete's metric,
// decide what to display, whether it may carry a verified badge, and whether
// sources disagree. RC never silently picks one value when sources conflict.

import { metricDef } from "./metrics";
import { MetricObservation, VERIFICATION_RANK, Verification } from "./types";

export interface ResolvedMetric {
  key: string;
  /** The observation shown first: highest verification, then most recent measurement. */
  primary: MetricObservation;
  /** Every observation, ordered the same way, so the UI can show them all. */
  observations: MetricObservation[];
  conflict: boolean;
  /** Plain-language description of the conflict, if any. */
  conflictDetail: string | null;
  /** True only when the badge is justified by the evidence — see canShowVerifiedBadge. */
  verifiedBadge: boolean;
}

function measuredTime(o: MetricObservation): number {
  return o.measuredAt ? Date.parse(o.measuredAt) : 0;
}

export function sortObservations(obs: MetricObservation[]): MetricObservation[] {
  return [...obs].sort((a, b) => {
    const v = VERIFICATION_RANK[b.verification] - VERIFICATION_RANK[a.verification];
    if (v !== 0) return v;
    return measuredTime(b) - measuredTime(a);
  });
}

/**
 * A green "verified" badge requires ALL of:
 *  - verification level is independently_verified or official
 *  - a named source record exists
 *  - the measurement date is known
 *  - no conflicting observation of equal-or-higher verification exists
 * Self-reported data can never be badged, whatever the source.
 */
export function canShowVerifiedBadge(primary: MetricObservation, conflict: boolean): boolean {
  const strongEnough = primary.verification === "independently_verified" || primary.verification === "official";
  return strongEnough && Boolean(primary.sourceId) && Boolean(primary.measuredAt) && !conflict;
}

export function resolveMetric(observations: MetricObservation[]): ResolvedMetric | null {
  if (observations.length === 0) return null;
  const sorted = sortObservations(observations);
  const primary = sorted[0];
  const def = metricDef(primary.metricKey);

  // A conflict is two *different sources* disagreeing beyond tolerance.
  // The same source re-measuring over time is progression, not conflict.
  const others = sorted.filter((o) => o.sourceId !== primary.sourceId);
  const disagreeing = others.filter((o) => Math.abs(o.value - primary.value) > def.conflictTolerance);
  // Only conflicts among sources whose data is at least as trustworthy as
  // self-reported matter for the badge; but all disagreements are surfaced.
  const conflict = disagreeing.length > 0;
  const conflictDetail = conflict
    ? [primary, ...disagreeing]
        .map(
          (o) =>
            `${def.format(o.value)} (${o.sourceName}${o.measuredAt ? `, measured ${o.measuredAt.slice(0, 10)}` : ", date unknown"})`,
        )
        .join(" vs ")
    : null;

  const strongConflict = disagreeing.some(
    (o) => VERIFICATION_RANK[o.verification] >= VERIFICATION_RANK[primary.verification],
  );

  return {
    key: primary.metricKey,
    primary,
    observations: sorted,
    conflict,
    conflictDetail,
    verifiedBadge: canShowVerifiedBadge(primary, strongConflict),
  };
}

export function resolveAll(observations: MetricObservation[]): Map<string, ResolvedMetric> {
  const byKey = new Map<string, MetricObservation[]>();
  for (const o of observations) {
    const list = byKey.get(o.metricKey) ?? [];
    list.push(o);
    byKey.set(o.metricKey, list);
  }
  const out = new Map<string, ResolvedMetric>();
  for (const [k, list] of byKey) {
    const r = resolveMetric(list);
    if (r) out.set(k, r);
  }
  return out;
}

export function isVerifiedLevel(v: Verification): boolean {
  return v === "independently_verified" || v === "official";
}

/** Age of a data point in days, for freshness labels. */
export function ageInDays(iso: string | null, now = new Date()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((now.getTime() - t) / 86_400_000);
}

export function freshnessLabel(checkedAt: string | null, now = new Date()): "fresh" | "aging" | "stale" | "unknown" {
  const d = ageInDays(checkedAt, now);
  if (d === null) return "unknown";
  if (d <= 7) return "fresh";
  if (d <= 30) return "aging";
  return "stale";
}
