import { describe, expect, it } from "vitest";
import { parseRecruitingRequest } from "@/lib/domain/parser";

const campus = { label: "Campus (Austin, TX)", lat: 30.2849, lng: -97.7341 };

describe("natural-language recruiting request parser", () => {
  it("parses the flagship request", () => {
    const p = parseRecruitingRequest(
      "Find 2027 and 2028 shortstops within 150 miles of campus. Minimum 5’10”, 175 pounds, 90 mph exit velocity. Show verified stats and film, monitor their upcoming games, and prepare camp invitations for qualified prospects.",
      campus,
    );
    expect(p.criteria.gradYears).toEqual([2027, 2028]);
    expect(p.criteria.positions).toEqual(["SS"]);
    expect(p.criteria.location).toMatchObject({ mode: "radius", radiusMi: 150 });
    const keys = Object.fromEntries(p.criteria.metrics.map((m) => [m.key, m]));
    expect(keys.height_in.value).toBe(70);
    expect(keys.weight_lb.value).toBe(175);
    expect(keys.exit_velo_mph.value).toBe(90);
    expect(keys.exit_velo_mph.verifiedOnly).toBe(true);
    expect(p.actions).toMatchObject({ monitorGames: true, prepareCampInvites: true, showFilm: true, saveMission: true });
    expect(p.warnings).toEqual([]);
  });
  it("parses 60-yard dash, GPA, states and uncommitted", () => {
    const p = parseRecruitingRequest("2027 catchers in Texas and Oklahoma, 60 under 7.0, 3.2 GPA, uncommitted only", null);
    expect(p.criteria.positions).toEqual(["C"]);
    expect(p.criteria.location).toEqual({ mode: "states", states: ["TX", "OK"] });
    expect(p.criteria.metrics.find((m) => m.key === "sixty_yd_sec")).toMatchObject({ op: "lte", value: 7 });
    expect(p.criteria.metrics.find((m) => m.key === "gpa")).toMatchObject({ value: 3.2, importance: "preferred" });
    expect(p.criteria.uncommittedOnly).toBe(true);
  });
  it("geocodes a named center", () => {
    const p = parseRecruitingRequest("2028 outfielders within 75 miles of Tulsa, OK", null);
    expect(p.criteria.location.mode).toBe("radius");
    expect(p.criteria.location.center?.label).toContain("Tulsa");
  });
  it("warns instead of guessing when campus is unknown", () => {
    const p = parseRecruitingRequest("shortstops within 50 miles of campus", null);
    expect(p.criteria.location.mode).toBe("nationwide");
    expect(p.warnings[0]).toMatch(/campus location/);
  });
});

describe("radius followed by a comma", () => {
  it("still reads the radius (regression: was treated as nationwide)", () => {
    const p = parseRecruitingRequest("2027 middle infielders within 75 miles, at least 5'10\", 88+ exit velo", { label: "Campus", lat: 33.15, lng: -117.18 });
    expect(p.criteria.location).toMatchObject({ mode: "radius", radiusMi: 75 });
    expect(p.criteria.positions.sort()).toEqual(["2B", "SS"]);
  });
});

describe("season stat searches", () => {
  it("understands batting average, ERA and home runs", () => {
    const p = parseRecruitingRequest("2027 shortstops hitting .350 with 5+ home runs; pitchers with ERA under 2.50", null);
    const m = Object.fromEntries(p.criteria.metrics.map((x) => [x.key, x]));
    expect(m.avg).toMatchObject({ op: "gte", value: 0.35 });
    expect(m.era).toMatchObject({ op: "lte", value: 2.5 });
    expect(m.hr).toMatchObject({ op: "gte", value: 5 });
  });
});
