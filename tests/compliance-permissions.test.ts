import { describe, expect, it } from "vitest";
import { checkEligibility, DEFAULT_COMPLIANCE, type ComplianceSettings } from "@/lib/domain/compliance";
import { can, assertCan } from "@/lib/domain/permissions";

const configured: ComplianceSettings = {
  ...DEFAULT_COMPLIANCE, configured: true, firstContactDateByGradYear: { "2027": "2025-08-01" },
  calendar: [{ start: "2026-12-20", end: "2027-01-03", type: "dead", note: "Holiday dead period" }],
};
const r = { gradYear: 2027, email: "a@b.com", guardianEmail: null, optedOut: false, contactConsent: "granted" as const, isMinor: true };

describe("compliance eligibility", () => {
  it("requires compliance review when settings are not configured", () => {
    expect(checkEligibility("initial", r, DEFAULT_COMPLIANCE, "2026-11-19").status).toBe("compliance_review");
  });
  it("blocks opted-out recipients and missing email", () => {
    expect(checkEligibility("initial", { ...r, optedOut: true }, configured, "2026-11-19").status).toBe("blocked");
    expect(checkEligibility("initial", { ...r, email: null }, configured, "2026-11-19").status).toBe("blocked");
  });
  it("is eligible when every configured check passes", () => {
    expect(checkEligibility("initial", r, configured, "2026-11-19").status).toBe("eligible");
  });
  it("reviews before the permitted date, in dead periods and without guardian consent", () => {
    expect(checkEligibility("initial", r, configured, "2025-07-01").status).toBe("compliance_review");
    expect(checkEligibility("initial", r, configured, "2026-12-25").reasons.join()).toMatch(/dead period/);
    expect(checkEligibility("initial", { ...r, contactConsent: "unknown" }, configured, "2026-11-19").status).toBe("compliance_review");
    expect(checkEligibility("initial", { ...r, gradYear: 2029 }, configured, "2026-11-19").reasons[0]).toMatch(/No permitted-contact date/);
  });
});

describe("permissions", () => {
  it("enforces the role matrix", () => {
    expect(can("head_coach", "manage_users")).toBe(true);
    expect(can("assistant_coach", "manage_users")).toBe(false);
    expect(can("viewer", "decide_approvals")).toBe(false);
    expect(can("compliance", "decide_compliance")).toBe(true);
    expect(can("compliance", "send_messages")).toBe(false);
    expect(() => assertCan("viewer", "follow")).toThrow(/does not allow/);
  });
});
