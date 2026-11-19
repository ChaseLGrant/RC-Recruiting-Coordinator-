import { describe, expect, it } from "vitest";
import { decideIdentity, scoreIdentity } from "@/lib/domain/identity";

const base = { firstName: "Michael", lastName: "Reyes", gradYear: 2027, highSchool: "Westlake High School", city: "Austin", state: "TX" };

describe("identity matching", () => {
  it("auto-merges strong, unambiguous matches (nickname + school)", () => {
    const d = decideIdentity({ ...base, firstName: "Mike", highSchool: "Westlake HS" }, [{ ...base, id: "a" }]);
    expect(d.kind).toBe("merge");
  });
  it("sends borderline matches to coach review", () => {
    const d = decideIdentity({ ...base, highSchool: null, city: null, state: null }, [{ ...base, id: "a" }]);
    expect(d.kind).toBe("review");
  });
  it("treats different grad years / states as different people", () => {
    expect(decideIdentity({ ...base, gradYear: 2029, state: "FL", highSchool: "Other" }, [{ ...base, id: "a" }]).kind).toBe("new");
    expect(scoreIdentity({ ...base, lastName: "Ramos" }, base).score).toBe(0);
  });
  it("does not auto-merge when two candidates are equally strong", () => {
    const d = decideIdentity(base, [{ ...base, id: "a" }, { ...base, id: "b" }]);
    expect(d.kind).toBe("review");
  });
});
