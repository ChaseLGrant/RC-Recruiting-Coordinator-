import { describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import { buildFast, copyOrg, orgTableOrder } from "@/lib/demo/fast-build";
import { createDemoProgram, createGuestDemo, createSchoolDemo, schoolDemoLook, GUEST_EMAIL_DOMAIN } from "@/lib/onboarding";
import { getOrg, listUsers } from "@/lib/repo";
import { purgeOldGuestDemos } from "@/lib/outreach/cleanup";
import { createProgram } from "@/lib/onboarding";
import { ensureProgramSlug, getOrgBySlug, setProgramSlug, slugify, validSlug } from "@/lib/program-link";
import { COLOR_PRESETS, contrast, deriveTheme, normalizeHex, readableOn, themeVars, WHITE } from "@/lib/theme";

const mem = () => createDb({ sqlitePath: ":memory:", url: "" });
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function countFor(db: Db, orgId: string) {
  const out: Record<string, number> = {};
  for (const { table, key } of orgTableOrder()) {
    const r = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${key} = ?`, [orgId]);
    out[table] = Number(r?.n ?? 0);
  }
  return out;
}

describe("theme tokens", () => {
  it("normalizes hex colors and rejects anything else", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("C8102E")).toBe("#c8102e");
    expect(normalizeHex("red")).toBeNull();
    expect(normalizeHex("#12345g")).toBeNull();
    expect(normalizeHex("url(x)")).toBeNull();
  });

  it("picks readable text for light and dark team colors", () => {
    expect(readableOn("#0c2340")).toBe(WHITE); // navy → white text
    expect(readableOn("#ffb81c")).not.toBe(WHITE); // gold → dark text
    for (const p of COLOR_PRESETS) {
      const t = deriveTheme({ primary: p.primary, accent: p.accent });
      // Buttons, accents and the dark header all keep readable text (WCAG AA for normal text where the color allows).
      expect(contrast(t.onPrimary, t.primary)).toBeGreaterThanOrEqual(4.5 - 0.6);
      expect(contrast(t.onAccent, t.accent)).toBeGreaterThanOrEqual(4.5 - 0.6);
      expect(contrast(t.onInk, t.ink)).toBeGreaterThanOrEqual(7);
      expect(contrast(t.accentOnInk, t.ink)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.primaryText, WHITE)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.mark, t.ink)).toBeGreaterThanOrEqual(1.6);
    }
  });

  it("keeps the team mark visible when the main color is as dark as the header", () => {
    const t = deriveTheme({ primary: "#111111", accent: "#cfb53b" });
    expect(t.mark).toBe("#cfb53b");
    const red = deriveTheme({ primary: "#c8102e", accent: "#111111" });
    expect(red.ink).toBe("#111111"); // a black secondary becomes the header
    expect(red.mark).toBe("#c8102e");
  });

  it("derives a dark header from a light primary and lightens text that would vanish", () => {
    const t = deriveTheme({ primary: "#4b9cd3", accent: "#ffffff" });
    expect(contrast(WHITE, t.ink)).toBeGreaterThanOrEqual(7);
    expect(t.primaryText).not.toBe("#4b9cd3"); // light blue is darkened for links on white
    const vars = themeVars(t);
    expect(Object.keys(vars)).toEqual(expect.arrayContaining(["--team-primary", "--team-on-primary", "--team-ink", "--team-accent-on-ink", "--team-mark"]));
  });
});

describe("fast demo build", () => {
  it("copies every row of a program from one database to another", async () => {
    const src = await mem();
    const dst = await mem();
    const { orgId } = await createDemoProgram(src, {
      programName: "Copy Test (DEMO)", campusZip: "92069", password: "password123", seedActivity: true,
      staff: [{ name: "Coach", title: "Head Coach", role: "head_coach", email: "copy@test.demo" }],
    });
    const copied = await copyOrg(src, dst, orgId);
    const a = await countFor(src, orgId);
    const b = await countFor(dst, orgId);
    expect(b).toEqual(a);
    expect(a.athletes).toBeGreaterThan(100);
    expect(copied).toBe(Object.values(a).reduce((x, y) => x + y, 0));
    // The copy is a working program: same org, same users, same login.
    expect((await getOrg(dst, orgId)).name).toBe("Copy Test (DEMO)");
    expect((await listUsers(dst, orgId)).map((u) => u.email)).toEqual((await listUsers(src, orgId)).map((u) => u.email));
  });

  it("builds in memory and ships the result when asked to (the Postgres path)", async () => {
    const db = await mem();
    const r = await buildFast(db, (target) => createDemoProgram(target, {
      programName: "Fast (DEMO)", campusZip: "78712", password: "password123",
      staff: [{ name: "Coach", title: "Head Coach", role: "head_coach", email: "fast@test.demo" }],
    }), { forceMemory: true });
    expect(r.mode).toBe("memory");
    const counts = await countFor(db, r.orgId);
    expect(counts.athletes).toBeGreaterThan(100);
    expect(counts.approvals).toBeGreaterThan(0);
  });
});

describe("See RC for your program", () => {
  it("builds a private, clearly labeled demo in the school's colors and logo", async () => {
    const db = await mem();
    const { orgId, userId } = await createSchoolDemo(db, { school: "Coastal State University", campus: "San Marcos, CA", primary: "#0c2340", accent: "#c99700", logoDataUrl: PNG });
    const org = await getOrg(db, orgId);
    expect(org.isDemo).toBe(true);
    expect(org.name).toMatch(/DEMO/);
    expect(org.settings.branding.teamName).toBe("Coastal State University Baseball");
    expect(org.settings.branding.primary).toBe("#0c2340");
    expect(org.settings.branding.accent).toBe("#c99700");
    expect(org.settings.branding.logoDataUrl).toBe(PNG);
    expect(org.campus?.label).toMatch(/San Marcos, CA/);
    const users = await listUsers(db, orgId);
    expect(users.find((u) => u.id === userId)?.email.endsWith(`@${GUEST_EMAIL_DOMAIN}`)).toBe(true);
    const athletes = await db.get<{ n: number; demo: number }>("SELECT COUNT(*) AS n, SUM(is_demo) AS demo FROM athletes WHERE org_id = ?", [orgId]);
    expect(Number(athletes?.n)).toBeGreaterThan(100);
    expect(Number(athletes?.demo)).toBe(Number(athletes?.n)); // every player is flagged fictional
    expect(org.slug).toBeNull(); // demos get no public sign-in page
  });

  it("checks the form and explains what's wrong", () => {
    expect(() => schoolDemoLook({ school: " " })).toThrow(/school or program name/);
    expect(() => schoolDemoLook({ school: "X".repeat(61) })).toThrow(/60 characters/);
    expect(() => schoolDemoLook({ school: "Coastal State", campus: "Atlantis, ZZ" })).toThrow(/couldn't find/);
    const look = schoolDemoLook({ school: "Ironwood College Baseball", primary: "nonsense", accent: "#111", logoDataUrl: "data:text/html;base64,PHNjcmlwdD4=" });
    expect(look.teamName).toBe("Ironwood College Baseball"); // no "Baseball Baseball"
    expect(look.branding?.primary).toBe("#1f3a68"); // bad color falls back
    expect(look.branding?.accent).toBe("#111111");
    expect(look.branding?.logoDataUrl).toBeNull(); // unsafe logo dropped
    expect(look.campusZip).toBe("78712");
    expect(schoolDemoLook({ school: "Coastal", campus: "92069" }).campusZip).toBe("92069");
  });

  it("expires try-it demos after 14 days and never touches real programs", async () => {
    const db = await mem();
    const old = await createGuestDemo(db);
    const fresh = await createGuestDemo(db);
    const real = await createProgram(db, { programName: "Real U", coachName: "Coach Real", email: "real@test.edu", password: "password123" });
    await db.run("UPDATE orgs SET created_at = ? WHERE id IN (?, ?)", [new Date(Date.now() - 15 * 86_400_000).toISOString(), old.orgId, real.orgId]);
    await db.run("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('s-old', ?, ?, ?)", [old.userId, new Date(Date.now() + 86_400_000).toISOString(), new Date().toISOString()]);
    expect(await purgeOldGuestDemos(db)).toBe(1);
    expect(await db.get("SELECT id FROM orgs WHERE id = ?", [old.orgId])).toBeUndefined();
    expect(await db.get("SELECT id FROM athletes WHERE org_id = ?", [old.orgId])).toBeUndefined();
    expect(await db.get("SELECT id FROM sessions WHERE id = 's-old'")).toBeUndefined();
    expect(await db.get("SELECT id FROM orgs WHERE id = ?", [fresh.orgId])).toBeTruthy();
    expect(await db.get("SELECT id FROM orgs WHERE id = ?", [real.orgId])).toBeTruthy();
  });
});

describe("branded staff sign-in link", () => {
  it("gives each real program a unique /p/<slug> and lets the head coach change it", async () => {
    const db = await mem();
    const a = await createProgram(db, { programName: "Palomar Baseball", coachName: "A", email: "a@p.edu", password: "password123" });
    const b = await createProgram(db, { programName: "Palomar Baseball", coachName: "B", email: "b@p.edu", password: "password123" });
    const sa = await ensureProgramSlug(db, await getOrg(db, a.orgId));
    const sb = await ensureProgramSlug(db, await getOrg(db, b.orgId));
    expect(sa).toBe("palomar-baseball");
    expect(sb).toBe("palomar-baseball-2");
    expect(await ensureProgramSlug(db, await getOrg(db, a.orgId))).toBe(sa); // stable
    expect((await getOrgBySlug(db, "palomar-baseball"))?.id).toBe(a.orgId);
    const ctx = { db, orgId: b.orgId, userId: b.userId, role: "head_coach" as const };
    await expect(setProgramSlug(ctx, "palomar-baseball")).rejects.toThrow(/taken/);
    await expect(setProgramSlug(ctx, "x")).rejects.toThrow(/3–40/);
    await expect(setProgramSlug(ctx, "login")).rejects.toThrow();
    expect(await setProgramSlug(ctx, "Palomar Comets!")).toBe("palomar-comets");
    await expect(setProgramSlug({ ...ctx, role: "viewer" }, "viewers-cant")).rejects.toThrow();
  });

  it("never exposes a demo through a sign-in link", async () => {
    const db = await mem();
    const d = await createGuestDemo(db);
    expect(await ensureProgramSlug(db, await getOrg(db, d.orgId))).toBeNull();
    await db.run("UPDATE orgs SET slug = 'sneaky-demo' WHERE id = ?", [d.orgId]);
    expect(await getOrgBySlug(db, "sneaky-demo")).toBeNull();
    expect(slugify("St. Mary's & Co")).toBe("st-marys-and-co");
    expect(validSlug("ab")).toBe(false);
  });
});

describe.runIf(Boolean(process.env.PG_TEST_URL))("fast demo build on Postgres", () => {
  it("builds in memory and lands the whole program in Postgres in one transaction", async () => {
    const db = await createDb({ url: process.env.PG_TEST_URL });
    const { orgId } = await createSchoolDemo(db, { school: "Ironwood College", campus: "85281", primary: "#c8102e", accent: "#111111" });
    const counts = await countFor(db, orgId);
    expect(counts.athletes).toBeGreaterThan(100);
    expect(counts.metric_observations).toBeGreaterThan(1000);
    expect((await getOrg(db, orgId)).settings.branding.teamName).toBe("Ironwood College Baseball");
    await purgeOldGuestDemos(db); // fresh demo stays
    expect(await db.get("SELECT id FROM orgs WHERE id = ?", [orgId])).toBeTruthy();
    await db.close();
  });
});
