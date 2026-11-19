import { describe, expect, it } from "vitest";
import { defaultCriteria, evaluateAthlete, sortMatches } from "@/lib/domain/criteria";
import type { RecruitingCriteria } from "@/lib/domain/types";
import { athlete, obs } from "./fixtures";

const campus = { label: "Campus", lat: 30.2849, lng: -97.7341 }; // Austin

function c(over: Partial<RecruitingCriteria> = {}): RecruitingCriteria {
  return { ...defaultCriteria(), gradYears: [2027], positions: ["SS"], location: { mode: "radius", center: campus, radiusMi: 150 }, ...over };
}

describe("criteria matching", () => {
  it("reports objective matches like 'Matches 5 of your 6 criteria'", () => {
    const crit = c({
      metrics: [
        { key: "height_in", op: "gte", value: 70, importance: "required" },
        { key: "weight_lb", op: "gte", value: 170, importance: "required" },
        { key: "exit_velo_mph", op: "gte", value: 90, importance: "required" },
      ],
    });
    const m = evaluateAthlete(athlete(), [
      obs({ metricKey: "height_in", value: 71 }),
      obs({ metricKey: "weight_lb", value: 160 }),
      obs({ metricKey: "exit_velo_mph", value: 93 }),
    ], crit);
    expect(m.total).toBe(6);
    expect(m.matched).toBe(5);
    expect(m.summary).toBe("Matches 5 of your 6 criteria");
    expect(m.eligible).toBe(false);
  });
  it("keeps missing information separate from failing", () => {
    const crit = c({ metrics: [{ key: "sixty_yd_sec", op: "lte", value: 7.0, importance: "required" }] });
    const m = evaluateAthlete(athlete(), [], crit);
    const sixty = m.criteria.find((r) => r.id === "metric:sixty_yd_sec")!;
    expect(sixty.status).toBe("missing");
    expect(m.failedRequired).toBe(0);
    expect(m.eligible).toBe(true); // default policy: include, flagged
    expect(m.summary).toContain("missing info");
  });
  it("lets the coach choose whether missing data excludes a prospect", () => {
    const crit = c({ missingPolicy: "exclude", metrics: [{ key: "sixty_yd_sec", op: "lte", value: 7.0, importance: "required" }] });
    expect(evaluateAthlete(athlete(), [], crit).eligible).toBe(false);
  });
  it("preferred/optional criteria never exclude", () => {
    const crit = c({ metrics: [{ key: "gpa", op: "gte", value: 3.2, importance: "preferred" }] });
    const m = evaluateAthlete(athlete(), [obs({ metricKey: "gpa", value: 2.9 })], crit);
    expect(m.eligible).toBe(true);
    expect(m.matched).toBe(m.total - 1);
  });
  it("handles lte metrics (60-yard dash)", () => {
    const crit = c({ metrics: [{ key: "sixty_yd_sec", op: "lte", value: 7.0, importance: "required" }] });
    expect(evaluateAthlete(athlete(), [obs({ metricKey: "sixty_yd_sec", value: 6.85 })], crit).eligible).toBe(true);
    expect(evaluateAthlete(athlete(), [obs({ metricKey: "sixty_yd_sec", value: 7.1 })], crit).eligible).toBe(false);
  });
  it("excludes athletes outside the radius and flags unknown locations as missing", () => {
    const far = athlete({ city: "Houston", lat: 29.7604, lng: -95.3698 }); // ~146 mi; within 150
    const veryFar = athlete({ city: "El Paso", lat: 31.7619, lng: -106.485 });
    expect(evaluateAthlete(far, [], c()).eligible).toBe(true);
    expect(evaluateAthlete(veryFar, [], c()).eligible).toBe(false);
    const unknown = evaluateAthlete(athlete({ lat: null, lng: null }), [], c());
    expect(unknown.criteria.find((r) => r.id === "location")!.status).toBe("missing");
  });
  it("matches secondary position only when allowed", () => {
    const a = athlete({ primaryPosition: "2B", secondaryPosition: "SS" });
    expect(evaluateAthlete(a, [], c()).eligible).toBe(true);
    expect(evaluateAthlete(a, [], c({ includeSecondaryPosition: false })).eligible).toBe(false);
  });
  it("verified-only standards reject self-reported values", () => {
    const crit = c({ metrics: [{ key: "exit_velo_mph", op: "gte", value: 90, importance: "required", verifiedOnly: true }] });
    const m = evaluateAthlete(athlete(), [obs({ value: 95, verification: "self_reported" })], crit);
    expect(m.criteria.find((r) => r.id === "metric:exit_velo_mph")!.status).toBe("unverified");
  });
  it("marks conflict when sources straddle the threshold", () => {
    const crit = c({ metrics: [{ key: "exit_velo_mph", op: "gte", value: 90, importance: "required" }] });
    const m = evaluateAthlete(athlete(), [obs({ value: 92, sourceId: "s1" }), obs({ value: 86, sourceId: "s2", verification: "official" })], crit);
    expect(m.criteria.find((r) => r.id === "metric:exit_velo_mph")!.status).toBe("conflict");
  });
  it("uncommitted-only requires verification", () => {
    const crit = c({ uncommittedOnly: true });
    expect(evaluateAthlete(athlete({ commitmentVerified: false }), [], crit).criteria.at(-1)!.status).toBe("unverified");
    expect(evaluateAthlete(athlete({ commitmentStatus: "committed" }), [], crit).eligible).toBe(false);
  });
  it("sorts eligible first without any talent score", () => {
    const rows = [
      { id: "x", match: evaluateAthlete(athlete({ id: "x", gradYear: 2029 }), [], c()) },
      { id: "y", match: evaluateAthlete(athlete({ id: "y" }), [], c()) },
    ];
    expect(sortMatches(rows)[0].id).toBe("y");
  });
});
