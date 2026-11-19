import { describe, expect, it } from "vitest";
import { resolveMetric, canShowVerifiedBadge, freshnessLabel } from "@/lib/domain/provenance";
import { obs } from "./fixtures";

describe("provenance / Evidence Mode", () => {
  it("prefers higher verification over recency", () => {
    const r = resolveMetric([
      obs({ value: 95, verification: "self_reported", measuredAt: "2026-10-01", sourceId: "s2", sourceName: "Family" }),
      obs({ value: 91.5, verification: "independently_verified", measuredAt: "2026-06-01" }),
    ])!;
    expect(r.primary.value).toBe(91.5);
    expect(r.observations).toHaveLength(2);
  });
  it("surfaces conflicts between different sources instead of silently choosing", () => {
    const r = resolveMetric([
      obs({ value: 91, sourceId: "s1", sourceName: "Showcase A" }),
      obs({ value: 87, sourceId: "s2", sourceName: "Showcase B", verification: "official" }),
    ])!;
    expect(r.conflict).toBe(true);
    expect(r.conflictDetail).toContain("Showcase A");
    expect(r.conflictDetail).toContain("Showcase B");
  });
  it("same source re-measuring over time is progression, not a conflict", () => {
    const r = resolveMetric([
      obs({ value: 86, measuredAt: "2025-06-01" }),
      obs({ value: 92, measuredAt: "2026-06-01" }),
    ])!;
    expect(r.conflict).toBe(false);
    expect(r.primary.value).toBe(92);
  });
  it("never badges self-reported or undated data", () => {
    expect(canShowVerifiedBadge(obs({ verification: "self_reported" }), false)).toBe(false);
    expect(canShowVerifiedBadge(obs({ verification: "unverified" }), false)).toBe(false);
    expect(canShowVerifiedBadge(obs({ measuredAt: null }), false)).toBe(false);
    expect(canShowVerifiedBadge(obs({}), true)).toBe(false);
    expect(canShowVerifiedBadge(obs({}), false)).toBe(true);
  });
  it("drops the badge when an equally-trusted source disagrees", () => {
    const r = resolveMetric([
      obs({ value: 91, sourceId: "s1" }),
      obs({ value: 85, sourceId: "s2", verification: "independently_verified", measuredAt: "2026-01-01" }),
    ])!;
    expect(r.verifiedBadge).toBe(false);
  });
  it("labels freshness", () => {
    const now = new Date("2026-11-19T00:00:00Z");
    expect(freshnessLabel("2026-11-18T00:00:00Z", now)).toBe("fresh");
    expect(freshnessLabel("2026-09-01T00:00:00Z", now)).toBe("stale");
    expect(freshnessLabel(null, now)).toBe("unknown");
  });
});
