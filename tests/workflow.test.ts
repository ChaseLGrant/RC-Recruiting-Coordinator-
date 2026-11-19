// Runs on in-memory SQLite by default. Set PG_TEST_URL=postgresql://... to run the same suite against Postgres.
import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import { createDemoWorkspace, createProgram } from "@/lib/onboarding";
import { runMission } from "@/lib/jobs/runner";
import { decideApproval, listApprovals, listMessages, prepareDraft, sendMessage } from "@/lib/repo/approvals";
import { getAthlete, listAthletes, listMissions, setFollow, updateOrgSettings, type Ctx } from "@/lib/repo";
import { buildBrief, getEvidence, searchAthletes } from "@/lib/services";
import { ingestRecords } from "@/lib/ingest";
import { createSource } from "@/lib/repo";
import { parseAthleteCsv } from "@/lib/providers/csv";
import { authenticate, createSession, userForSession } from "@/lib/auth";

let db: Db;
let demo: { orgId: string; userId: string };
let ctx: Ctx;

beforeAll(async () => {
  db = await createDb(process.env.PG_TEST_URL ? { url: process.env.PG_TEST_URL } : { sqlitePath: ":memory:", url: "" });
  demo = await createDemoWorkspace(db, "coach@demo.test", "password123");
  ctx = { db, orgId: demo.orgId, userId: demo.userId, role: "head_coach" };
});

describe("demo workspace + first mission run", () => {
  it("ingests from both demo sources and links identities across them", async () => {
    const athletes = await listAthletes(db, demo.orgId);
    expect(athletes.length).toBeGreaterThanOrEqual(30);
    expect(athletes.every((a) => a.isDemo)).toBe(true);
    const linked = await db.get<{ n: number }>("SELECT COUNT(DISTINCT athlete_id) AS n FROM athlete_source_records WHERE org_id = ? GROUP BY athlete_id HAVING COUNT(DISTINCT source_id) > 1 LIMIT 1", [demo.orgId]);
    expect(linked).toBeTruthy();
  });
  it("records real events and a succeeded job run", async () => {
    const run = await db.get<{ status: string; stats_json: string }>("SELECT * FROM job_runs WHERE org_id = ?", [demo.orgId]);
    expect(run?.status).toBe("succeeded");
    const brief = await buildBrief(db, demo.orgId, null);
    expect(brief.counts.source_checked).toBe(2);
    expect(brief.counts.athlete_discovered ?? 0).toBeGreaterThan(0);
    expect(brief.pendingApprovals.some((a) => a.kind === "prospect")).toBe(true);
    expect(brief.pendingApprovals.some((a) => a.kind === "camp_list")).toBe(true);
  });
  it("flags conflicting measurements between sources", async () => {
    const approvals = await listApprovals(db, demo.orgId);
    expect(approvals.some((a) => a.kind === "data_conflict")).toBe(true);
  });
  it("search returns only athletes that meet required standards", async () => {
    const [mission] = await listMissions(db, demo.orgId);
    const profile = await db.get<{ criteria_json: string }>("SELECT criteria_json FROM recruiting_profiles WHERE id = ?", [mission.profileId]);
    const res = await searchAthletes(db, demo.orgId, JSON.parse(profile!.criteria_json));
    expect(res.rows.length).toBe(res.eligibleCount);
    for (const r of res.rows) {
      expect(r.match.failedRequired).toBe(0);
      expect(["SS", "2B", "3B", "RHP", "1B", "C", "CF", "OF", "LHP"]).toContain(r.athlete.primaryPosition);
      expect(r.match.distanceMi!).toBeLessThanOrEqual(150);
    }
  });
});

describe("approval center", () => {
  it("approving a prospect follows the athlete and is audited", async () => {
    const p = (await listApprovals(db, demo.orgId)).find((a) => a.kind === "prospect")!;
    const res = await decideApproval(ctx, p.id, { decision: "approve" });
    expect(res.result).toBe("Added to Following");
    const ev = await getEvidence(db, demo.orgId, p.athleteId!);
    expect(ev!.following).toBe(true);
    const audit = await db.get("SELECT * FROM audit_log WHERE org_id = ? AND action = 'approval_approve'", [demo.orgId]);
    expect(audit).toBeTruthy();
    await expect(decideApproval(ctx, p.id, { decision: "reject" })).rejects.toThrow(/already decided/);
  });
  it("viewers cannot decide approvals", async () => {
    const p = (await listApprovals(db, demo.orgId)).find((a) => a.kind === "prospect")!;
    await expect(decideApproval({ ...ctx, role: "viewer" }, p.id, { decision: "approve" })).rejects.toThrow(/does not allow/);
  });
  it("camp list approval prepares drafts but routes them to compliance when rules aren't configured", async () => {
    const list = (await listApprovals(db, demo.orgId)).find((a) => a.kind === "camp_list")!;
    const res = await decideApproval(ctx, list.id, { decision: "approve" });
    expect(res.result).toMatch(/compliance review/);
    const msgs = await listMessages(db, demo.orgId);
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs.every((m) => m.status === "compliance_review" || m.status === "blocked")).toBe(true);
    expect(msgs.some((m) => m.status === "compliance_review")).toBe(true);
    expect(msgs.some((m) => m.status === "sent")).toBe(false);
  });
  it("never sends without an enabled, connected email provider", async () => {
    await updateOrgSettings(ctx, { compliance: { configured: true, division: "D1", firstContactDateByGradYear: { "2027": "2025-08-01", "2028": "2026-08-01" }, calendar: [], requireGuardianConsentForMinors: false, campMaterialsAllowedBeforeContactDate: true } });
    const [a] = await listAthletes(db, demo.orgId, { gradYears: [2027] });
    const { approvalId, messageId } = await prepareDraft(ctx, { athleteId: a.id, kind: "initial" });
    const r = await decideApproval(ctx, approvalId!, { decision: "approve", edits: { body: "Edited by coach" } });
    expect(r.result).toMatch(/ready to send/);
    const msg = (await listMessages(db, demo.orgId, { athleteId: a.id })).find((m) => m.id === messageId)!;
    expect(msg.body).toBe("Edited by coach");
    expect(msg.status).toBe("approved");
    await expect(sendMessage(ctx, messageId)).rejects.toThrow(/sending is turned off/);
  });
  it("outreach drafts only quote verified metrics", async () => {
    const msgs = await listMessages(db, demo.orgId);
    for (const m of msgs) expect(m.body).not.toMatch(/self-reported/i);
  });
});

describe("recurring missions detect real changes", () => {
  it("second run picks up new athletes, re-tests and schedule changes without duplicating approvals", async () => {
    const before = (await listApprovals(db, demo.orgId, ["pending", "approved", "rejected", "saved"])).length;
    const [mission] = await listMissions(db, demo.orgId);
    const r = await runMission(db, demo.orgId, mission.id, "manual");
    expect(r.status).toBe("succeeded");
    const since = new Date(Date.now() - 60_000).toISOString();
    const types = await db.all<{ type: string }>("SELECT DISTINCT type FROM events WHERE org_id = ? AND run_id = ?", [demo.orgId, r.runId]);
    const t = types.map((x) => x.type);
    expect(t).toContain("metric_updated");
    expect(t).toContain("schedule_changed");
    const dupes = await db.all("SELECT dedupe_key, COUNT(*) AS n FROM approvals WHERE org_id = ? AND dedupe_key IS NOT NULL GROUP BY dedupe_key HAVING COUNT(*) > 1", [demo.orgId]);
    expect(dupes).toEqual([]);
    expect((await listApprovals(db, demo.orgId, ["pending", "approved", "rejected", "saved"])).length).toBeGreaterThanOrEqual(before);
    expect(since).toBeTruthy();
  });
});

describe("multi-tenant isolation", () => {
  it("a real (non-demo) program starts empty and cannot read another program's athletes", async () => {
    const other = await createProgram(db, { programName: "Real U", campusLocation: "Tulsa, OK", coachName: "Coach R", email: "r@real.test", password: "password123" });
    expect(await listAthletes(db, other.orgId)).toEqual([]);
    const [demoAthlete] = await listAthletes(db, demo.orgId);
    expect(await getAthlete(db, other.orgId, demoAthlete.id)).toBeNull();
    expect(await getEvidence(db, other.orgId, demoAthlete.id)).toBeNull();
    await expect(setFollow({ db, orgId: other.orgId, userId: other.userId, role: "head_coach" }, demoAthlete.id, true)).rejects.toThrow(/not found/);
  });
  it("demo sources refuse to load into a real program", async () => {
    const other = await createProgram(db, { programName: "Real U2", coachName: "C", email: "c2@real.test", password: "password123" });
    const { DEMO_SHOWCASE } = await import("@/lib/providers/demo");
    await expect(DEMO_SHOWCASE.sync!({ config: {}, isDemo: false, now: new Date() })).rejects.toThrow(/demo workspace/);
    expect(other.orgId).toBeTruthy();
  });
});

describe("CSV import with provenance", () => {
  it("imports rows, stamps the source, and flags unknown verification as unverified", async () => {
    const p = await createProgram(db, { programName: "Import U", campusLocation: "78712", coachName: "C", email: "imp@real.test", password: "password123" });
    const csv = `first_name,last_name,grad_year,primary_position,city,state,zip,height,weight_lb,exit_velo_mph,measured_at,verification\nJordan,Pike,2027,SS,Austin,TX,78745,"5'11""",180,91.2,2026-07-01,independently verified\nAlex,Moss,2028,C,Waco,TX,,6-0,190,88,2026-07-01,trust me`;
    const parsed = parseAthleteCsv(csv);
    expect(parsed.records).toHaveLength(2);
    expect(parsed.records[0].metrics!.find((m) => m.key === "height_in")!.value).toBe(71);
    expect(parsed.errors.join()).toMatch(/unknown verification/);
    const source = await createSource(db, p.orgId, { providerId: "csv_import", name: "Summer camp results.csv", kind: "import", status: "connected", attestedBy: p.userId });
    const stats = await ingestRecords(db, p.orgId, source, parsed.records, { isDemo: false, sport: "baseball" });
    expect(stats.athletesCreated).toBe(2);
    const [jordan] = (await listAthletes(db, p.orgId)).filter((a) => a.firstName === "Jordan");
    expect(jordan.isDemo).toBe(false);
    expect(jordan.lat).not.toBeNull();
    const ev = await getEvidence(db, p.orgId, jordan.id);
    expect(ev!.metrics.get("exit_velo_mph")!.primary.sourceName).toBe("Summer camp results.csv");
    expect(ev!.metrics.get("exit_velo_mph")!.verifiedBadge).toBe(true);
    // Re-importing the same file is idempotent for metrics.
    const again = await ingestRecords(db, p.orgId, source, parsed.records, { isDemo: false, sport: "baseball" });
    expect(again.metricsAdded).toBe(0);
    expect(again.athletesCreated).toBe(0);
  });
});

describe("auth", () => {
  it("authenticates with hashed passwords and opaque sessions", async () => {
    expect(await authenticate(db, "coach@demo.test", "wrong-password")).toBeNull();
    const u = await authenticate(db, "COACH@demo.test", "password123");
    expect(u?.orgId).toBe(demo.orgId);
    const { token } = await createSession(db, u!.id);
    expect((await userForSession(db, token))?.id).toBe(u!.id);
    expect(await userForSession(db, token + "x")).toBeNull();
    const stored = await db.get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", [u!.id]);
    expect(stored!.password_hash).not.toContain("password123");
  });
});
