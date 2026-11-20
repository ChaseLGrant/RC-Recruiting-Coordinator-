// Trust & safety guarantees. Each test pins a promise RC makes to coaches,
// athletes and families. Runs on SQLite by default; PG_TEST_URL runs it on Postgres.
import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import { createProgram } from "@/lib/onboarding";
import { authenticate, LockedOutError } from "@/lib/auth";
import { safeUrl } from "@/lib/domain/urls";
import { createSource, getAthlete, listAthletes, updateAthleteContact, updateOrgSettings, type Ctx } from "@/lib/repo";
import { ingestRecords } from "@/lib/ingest";
import { createCamp, decideApproval, deleteAthleteData, listMessages, prepareDraft, sendMessage, markMessageSentManually } from "@/lib/repo/approvals";
import { getEvidence } from "@/lib/services";

let db: Db;
let ctx: Ctx;

beforeAll(async () => {
  db = await createDb(process.env.PG_TEST_URL ? { url: process.env.PG_TEST_URL } : { sqlitePath: ":memory:", url: "" });
  const p = await createProgram(db, { programName: "Trust U", campusLocation: "78712", coachName: "Coach T", email: `t${Date.now()}@trust.test`, password: "password123" });
  ctx = { db, orgId: p.orgId, userId: p.userId, role: "head_coach" };
});

describe("links are only ever safe web addresses", () => {
  it("accepts normal http(s) links and rejects everything else", () => {
    expect(safeUrl("https://example.com/film/1")).toBe("https://example.com/film/1");
    for (const bad of ["javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd", "not a url", "https://user:pw@example.com", "http://localhost/x", ""]) {
      expect(safeUrl(bad)).toBeNull();
    }
  });
  it("drops unsafe links from imported data instead of storing them", async () => {
    const source = await createSource(db, ctx.orgId, { providerId: "csv_import", name: "Evil file.csv", kind: "import", status: "connected" });
    await ingestRecords(db, ctx.orgId, source, [{
      firstName: "Link", lastName: "Tester", gradYear: 2027, state: "TX", city: "Austin",
      metrics: [{ key: "exit_velo_mph", value: 90, measuredAt: "2026-07-01", verification: "unverified", sourceUrl: "javascript:alert(1)" }],
      film: [{ url: "javascript:alert(document.cookie)" }, { url: "https://example.com/real-film" }],
      games: [{ startsAt: "2027-03-01T20:00:00Z", opponent: "X", sourceUrl: "data:text/html,hi" }],
    }], { isDemo: false, sport: "baseball" });
    const [a] = (await listAthletes(db, ctx.orgId)).filter((x) => x.lastName === "Tester");
    const ev = (await getEvidence(db, ctx.orgId, a.id))!;
    expect(ev.metrics.get("exit_velo_mph")!.primary.sourceUrl).toBeNull();
    expect(ev.film.map((f) => f.url)).toEqual(["https://example.com/real-film"]);
    expect(ev.games[0].source_url).toBeNull();
  });
  it("rejects unsafe camp registration links", async () => {
    await expect(createCamp(ctx, { name: "C", startsAt: "2027-01-01T00:00:00Z", location: null, registrationUrl: "javascript:alert(1)", profileId: null })).rejects.toThrow(/https/);
  });
});

describe("sign-in brute-force protection", () => {
  it("locks an account after 5 failed attempts and never reveals whether it exists", async () => {
    const email = `lock${Date.now()}@trust.test`;
    await createProgram(db, { programName: "L", coachName: "L", email, password: "correct-horse" });
    for (let i = 0; i < 5; i++) expect(await authenticate(db, email, "wrong")).toBeNull();
    await expect(authenticate(db, email, "correct-horse")).rejects.toBeInstanceOf(LockedOutError);
    expect(await authenticate(db, "nobody@nowhere.test", "x")).toBeNull();
  });
  it("a successful sign-in resets the failure count", async () => {
    const email = `reset${Date.now()}@trust.test`;
    await createProgram(db, { programName: "R", coachName: "R", email, password: "correct-horse" });
    for (let i = 0; i < 4; i++) await authenticate(db, email, "wrong");
    expect(await authenticate(db, email, "correct-horse")).not.toBeNull();
    for (let i = 0; i < 4; i++) await authenticate(db, email, "wrong");
    expect(await authenticate(db, email, "correct-horse")).not.toBeNull();
  });
});

describe("opt-outs always win", () => {
  it("an athlete who opts out after approval cannot be messaged — not by Send, not by 'mark sent'", async () => {
    await updateOrgSettings(ctx, { emailSendingEnabled: true, compliance: { configured: true, division: "D1", firstContactDateByGradYear: { "2027": "2025-01-01" }, calendar: [], requireGuardianConsentForMinors: false, campMaterialsAllowedBeforeContactDate: false } });
    const [a] = (await listAthletes(db, ctx.orgId)).filter((x) => x.lastName === "Tester");
    await updateAthleteContact(ctx, a.id, { email: "link.tester@example.com" });
    const { approvalId, messageId } = await prepareDraft(ctx, { athleteId: a.id, kind: "initial" });
    expect((await decideApproval(ctx, approvalId!, { decision: "approve" })).result).toMatch(/ready to send/);
    await updateAthleteContact(ctx, a.id, { optedOut: true });
    await expect(sendMessage(ctx, messageId)).rejects.toThrow(/opted out/);
    const msg = (await listMessages(db, ctx.orgId, { athleteId: a.id })).find((m) => m.id === messageId)!;
    expect(msg.status).toBe("blocked");
    await expect(markMessageSentManually(ctx, messageId)).rejects.toThrow();
  });
});

describe("privacy: removing an athlete's data", () => {
  it("only an admin can delete, a reason is required, everything is removed, and the deletion is audited without personal details", async () => {
    const [a] = (await listAthletes(db, ctx.orgId)).filter((x) => x.lastName === "Tester");
    await expect(deleteAthleteData({ ...ctx, role: "assistant_coach" }, a.id, "family request")).rejects.toThrow(/does not allow/);
    await expect(deleteAthleteData(ctx, a.id, " ")).rejects.toThrow(/reason/);
    await deleteAthleteData(ctx, a.id, "Parent requested removal");
    expect(await getAthlete(db, ctx.orgId, a.id)).toBeNull();
    for (const t of ["metric_observations", "film_links", "games", "messages", "athlete_source_records", "events", "approvals"]) {
      const r = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} WHERE athlete_id = ?`, [a.id]);
      expect(Number(r!.n), t).toBe(0);
    }
    const log = await db.get<{ detail_json: string }>("SELECT detail_json FROM audit_log WHERE action = 'delete_athlete_data' AND entity_id = ?", [a.id]);
    expect(log!.detail_json).toContain("Parent requested removal");
    expect(log!.detail_json).not.toContain("Tester");
  });
});
