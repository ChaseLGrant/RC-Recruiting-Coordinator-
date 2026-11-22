import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { createDb } from "@/lib/db";
import { createProgram } from "@/lib/onboarding";
import { createSource, getAthlete, listAthletes, listNotes, setFollow, type Ctx } from "@/lib/repo";
import { ingestRecords } from "@/lib/ingest";
import { researchPlayer, runAgentBatch, getAgentClient, type AgentClient } from "@/lib/agent/crm-agent";
import { decideApproval, listApprovals } from "@/lib/repo/approvals";
import { getEvidence } from "@/lib/services";

const future = new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10);

/** Fake Claude: returns search results plus a JSON answer, like the real web search flow. */
function fakeClient(answer: object, searched: string[], opts: { pauseFirst?: boolean } = {}): AgentClient & { calls: Anthropic.Beta.MessageCreateParamsNonStreaming[] } {
  const calls: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  return {
    calls,
    beta: { messages: { async create(params) {
      calls.push(params);
      const search = { type: "web_search_tool_result", tool_use_id: "srv_1", content: searched.map((url) => ({ type: "web_search_result", url, title: url, encrypted_content: "x", page_age: null })) };
      if (opts.pauseFirst && calls.length === 1) {
        return { id: "m1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [search], stop_reason: "pause_turn", usage: { input_tokens: 1000, output_tokens: 100, server_tool_use: { web_search_requests: 2 } } } as unknown as Anthropic.Beta.BetaMessage;
      }
      return {
        id: "m2", type: "message", role: "assistant", model: "claude-opus-5-5",
        content: [...(opts.pauseFirst ? [] : [search]), { type: "text", text: "```json\n" + JSON.stringify(answer) + "\n```" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 20000, output_tokens: 1500, server_tool_use: { web_search_requests: 3 } },
      } as unknown as Anthropic.Beta.BetaMessage;
    } } },
  };
}

async function setup() {
  const db = await createDb({ sqlitePath: ":memory:", url: "" });
  const p = await createProgram(db, { programName: "Agent U", campusLocation: "92069", coachName: "Coach", email: `a${Math.random()}@agent.test`, password: "password123" });
  const ctx: Ctx = { db, orgId: p.orgId, userId: p.userId, role: "head_coach" };
  const src = await createSource(db, p.orgId, { providerId: "manual", name: "Seen by Coach", kind: "manual", status: "connected" });
  await ingestRecords(db, p.orgId, src, [{ firstName: "Jordan", lastName: "Pike", gradYear: 2027, primaryPosition: "SS", highSchool: "Mission Hills HS", city: "San Marcos", state: "CA", metrics: [{ key: "avg", value: 0.31, measuredAt: "2026-10-01", verification: "unverified" }] }], { isDemo: false, sport: "baseball" });
  const [a] = await listAthletes(db, p.orgId);
  await setFollow(ctx, a.id, true, "priority");
  return { db, ctx, a };
}

const MP = "https://www.maxpreps.com/ca/san-marcos/mission-hills/athletes/jordan-pike/";
const NEWS = "https://www.sandiegouniontribune.com/sports/jordan-pike-commits";
const X = "https://x.com/jpike_27";

describe("AI research agent", () => {
  it("proposes only verifiable updates, and applies the ones a coach keeps", async () => {
    const { db, ctx, a } = await setup();
    const client = fakeClient({
      identity: { confident: true, reason: "Mission Hills SS, class of 2027, San Marcos" },
      updates: [
        { type: "commitment", summary: "Committed to UC Irvine", details: { status: "committed", college: "UC Irvine", date: "2026-11-15" }, sourceUrl: NEWS, sourceTitle: "Pike commits to UCI", quote: "Mission Hills shortstop Jordan Pike committed to UC Irvine" },
        { type: "stat", summary: "Batting avg .345", details: { key: "avg", value: 0.345, season: "2026" }, sourceUrl: MP, sourceTitle: "MaxPreps", quote: "AVG .345" },
        { type: "game", summary: "vs Carlsbad", details: { date: future, time: "3:30 PM", opponent: "Carlsbad", location: "Mission Hills HS" }, sourceUrl: MP, quote: `${future} vs Carlsbad 3:30 PM` },
        { type: "social", summary: "X account", details: { url: X, site: "X" }, sourceUrl: X, quote: "SS | Mission Hills '27" },
        // Each of these must be thrown out by RC's checks:
        { type: "stat", summary: "Invented source", details: { key: "hr", value: 4 }, sourceUrl: "https://made-up.example.org/pike", quote: "4 HR" },
        { type: "news", summary: "Tore his ACL", details: { headline: "Pike injury update" }, sourceUrl: NEWS, quote: "Pike suffered a torn ACL" },
        { type: "stat", summary: "Impossible average", details: { key: "avg", value: 1.4 }, sourceUrl: MP, quote: "AVG 1.400" },
        { type: "stat", summary: "Unchanged", details: { key: "avg", value: 0.31 }, sourceUrl: MP, quote: "AVG .310" },
        { type: "news", summary: "No quote", details: { headline: "x" }, sourceUrl: NEWS, quote: "" },
      ],
    }, [MP, NEWS, X], { pauseFirst: true });

    const r = await researchPlayer(db, ctx.orgId, a.id, { client });
    expect(r.status).toBe("updates");
    expect(r.proposed).toBe(4);
    expect(r.costCents).toBeGreaterThan(0);
    // The request used the current model, web search tool, and fallbacks; and continued after pause_turn.
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]).toMatchObject({ model: "claude-opus-5-5", tools: [{ type: "web_search_20260209", name: "web_search" }], fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] });
    expect(JSON.stringify(client.calls[0].messages)).toContain("Mission Hills HS");

    const ap = (await listApprovals(db, ctx.orgId)).find((x) => x.kind === "crm_update")!;
    const ups = ap.payload.updates as Array<{ id: string; type: string }>;
    expect(ups.map((u) => u.type).sort()).toEqual(["commitment", "game", "social", "stat"]);

    // Coach keeps everything except the game.
    const keep = ups.filter((u) => u.type !== "game").map((u) => u.id);
    const res = await decideApproval(ctx, ap.id, { decision: "approve", acceptIds: keep });
    expect(res.result).toBe("Applied 3 updates, skipped 1.");
    const after = (await getAthlete(db, ctx.orgId, a.id))!;
    expect(after.commitmentStatus).toBe("committed");
    expect(after.commitmentVerified).toBe(false);
    expect(after.xHandle).toBe("jpike_27");
    const ev = (await getEvidence(db, ctx.orgId, a.id))!;
    expect(ev.metrics.get("avg")!.primary.value).toBe(0.345);
    expect(ev.metrics.get("avg")!.primary.sourceUrl).toBe(MP);
    expect(ev.games.filter((g) => g.starts_at > new Date().toISOString())).toHaveLength(0);
    expect((await listNotes(db, ctx.orgId, a.id))[0].body).toMatch(/Committed to UC Irvine.*sandiegouniontribune/);
  });

  it("proposes nothing when it can't confirm it found the right player", async () => {
    const { db, ctx, a } = await setup();
    const client = fakeClient({ identity: { confident: false, reason: "Two players named Jordan Pike; none at Mission Hills" }, updates: [{ type: "stat", details: { key: "hr", value: 9 }, sourceUrl: MP, quote: "9 HR" }] }, [MP]);
    const r = await researchPlayer(db, ctx.orgId, a.id, { client });
    expect(r.status).toBe("identity_unsure");
    expect((await listApprovals(db, ctx.orgId)).filter((x) => x.kind === "crm_update")).toHaveLength(0);
  });

  it("is honest when not connected, skips opted-out players, and the batch respects schedule and daily limits", async () => {
    expect(getAgentClient({})).toBeNull();
    const { db, ctx, a } = await setup();
    expect((await researchPlayer(db, ctx.orgId, a.id, { client: null })).status).toBe("not_configured");
    const client = fakeClient({ identity: { confident: true, reason: "ok" }, updates: [] }, [MP]);
    let batch = await runAgentBatch(db, { client });
    expect(batch[0]).toMatchObject({ researched: 1 });
    batch = await runAgentBatch(db, { client }); // checked recently → not due again
    expect(batch[0]).toMatchObject({ researched: 0 });
    await db.run("UPDATE athletes SET opted_out = 1 WHERE id = ?", [a.id]);
    await db.run("DELETE FROM agent_runs");
    batch = await runAgentBatch(db, { client });
    expect(batch[0]).toMatchObject({ researched: 0 });
  });
});
