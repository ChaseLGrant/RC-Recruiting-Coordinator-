import { describe, expect, it } from "vitest";
import { createDb } from "@/lib/db";
import { townsNear } from "@/lib/providers/demo";
import { sanitizeBranding, listUsers, listAthletes, getOrg } from "@/lib/repo";
import { createDemoProgram } from "@/lib/onboarding";
import { haversineMiles, geocodeZip } from "@/lib/domain/geo";

describe("program branding", () => {
  it("only accepts real hex colors and safe image data", () => {
    const b = sanitizeBranding({ primary: "red; background:url(x)", ink: "#141414", logoDataUrl: "data:text/html;base64,PHNjcmlwdD4=" });
    expect(b.primary).toBe("#1f3a68");
    expect(b.ink).toBe("#141414");
    expect(b.logoDataUrl).toBeNull();
    expect(sanitizeBranding({ logoDataUrl: "data:image/png;base64,iVBORw0KGgo=" }).logoDataUrl).toMatch(/^data:image\/png/);
    expect(sanitizeBranding({ logoDataUrl: "javascript:alert(1)" }).logoDataUrl).toBeNull();
  });
});

describe("region-aware demo data", () => {
  it("uses real towns near the program's campus", () => {
    const campus = geocodeZip("92069")!;
    const towns = townsNear("92069");
    expect(towns.length).toBeGreaterThanOrEqual(12);
    expect(towns.every(([, st]) => ["CA", "AZ", "NV"].includes(st))).toBe(true);
    const near = towns.filter(([, , zip]) => haversineMiles(campus, geocodeZip(zip)!) <= 60);
    expect(near.length).toBeGreaterThanOrEqual(10);
  });
  it("builds a branded demo with staff accounts and fictional local players", async () => {
    const db = await createDb({ sqlitePath: ":memory:", url: "" });
    const { orgId } = await createDemoProgram(db, {
      programName: "Test College Baseball (DEMO)", teamName: "Test Baseball", campusZip: "92069",
      branding: { primary: "#c8102e", ink: "#141414", accent: "#a7a9ac" }, password: "password123",
      staff: [
        { name: "Head Coach", title: "Head Coach", role: "head_coach", email: "hc@test.demo" },
        { name: "Assistant One", title: "Pitching Coach", role: "assistant_coach", email: "a1@test.demo" },
      ],
    });
    const org = await getOrg(db, orgId);
    expect(org.isDemo).toBe(true);
    expect(org.settings.branding.teamName).toBe("Test Baseball");
    expect(org.settings.branding.primary).toBe("#c8102e");
    const users = await listUsers(db, orgId);
    expect(users.map((u) => u.role)).toEqual(["head_coach", "assistant_coach"]);
    const athletes = await listAthletes(db, orgId);
    expect(athletes.length).toBeGreaterThan(50);
    expect(athletes.every((a) => a.isDemo)).toBe(true);
    expect(athletes.filter((a) => a.state === "CA").length / athletes.length).toBeGreaterThan(0.8);
    const run = await db.get<{ status: string }>("SELECT status FROM job_runs WHERE org_id = ?", [orgId]);
    expect(run?.status).toBe("succeeded");
  });
});
