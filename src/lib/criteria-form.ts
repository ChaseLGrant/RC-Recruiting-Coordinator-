// Converts the Discover page's structured form into RecruitingCriteria and
// round-trips criteria through the URL so every search is shareable/editable.

import { defaultCriteria } from "./domain/criteria";
import { geocode, normalizeState } from "./domain/geo";
import { METRIC_KEYS, METRICS, parseHeight } from "./domain/metrics";
import type { Importance, MetricCriterion, RecruitingCriteria } from "./domain/types";
import type { Org } from "./repo";

export function encodeCriteria(c: RecruitingCriteria): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

export function decodeCriteria(s: string | null | undefined): RecruitingCriteria | null {
  if (!s) return null;
  try {
    const c = JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as RecruitingCriteria;
    return { ...defaultCriteria(c.sport), ...c };
  } catch {
    return null;
  }
}

type FormLike = { get(k: string): unknown; getAll(k: string): unknown[] };

export function criteriaFromForm(fd: FormLike, org: Pick<Org, "campus" | "sport">): { criteria: RecruitingCriteria; warnings: string[] } {
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const warnings: string[] = [];
  const c = defaultCriteria(org.sport);
  c.gradYears = fd.getAll("gradYears").map(Number).filter((n) => Number.isInteger(n));
  c.positions = fd.getAll("positions").map(String);
  c.includeSecondaryPosition = Boolean(s("includeSecondary"));
  c.uncommittedOnly = Boolean(s("uncommittedOnly"));
  c.missingPolicy = s("missingPolicy") === "exclude" ? "exclude" : "include";

  const mode = s("locationMode");
  if (mode === "radius") {
    const radius = Number(s("radiusCustom") || s("radius"));
    const centerText = s("center");
    let center: RecruitingCriteria["location"]["center"] | null = null;
    if (!centerText || /^campus$/i.test(centerText)) {
      if (org.campus) center = org.campus;
      else warnings.push("Set your campus location in Settings to search by radius from campus.");
    } else {
      const g = geocode(centerText);
      if (g) center = { label: g.label, lat: g.lat, lng: g.lng };
      else warnings.push(`Couldn't find "${centerText}". Use a ZIP code or "City, ST".`);
    }
    if (center && radius > 0) c.location = { mode: "radius", center, radiusMi: radius };
  } else if (mode === "states") {
    const states = s("states")
      .split(/[,\s]+/)
      .map((x) => normalizeState(x))
      .filter((x): x is string => Boolean(x));
    if (states.length) c.location = { mode: "states", states: Array.from(new Set(states)) };
    else warnings.push("No valid states entered (use abbreviations like TX, OK).");
  }

  const metrics: MetricCriterion[] = [];
  for (const key of METRIC_KEYS) {
    const raw = s(`m_${key}`);
    if (!raw) continue;
    const value = key === "height_in" ? parseHeight(raw) ?? Number(raw) : Number(raw);
    if (!Number.isFinite(value)) {
      warnings.push(`${METRICS[key].label}: "${raw}" isn't a number.`);
      continue;
    }
    metrics.push({
      key,
      op: METRICS[key].better === "lower" ? "lte" : "gte",
      value,
      importance: (s(`imp_${key}`) || "required") as Importance,
      verifiedOnly: Boolean(s(`ver_${key}`)),
    });
  }
  c.metrics = metrics;
  return { criteria: c, warnings };
}
