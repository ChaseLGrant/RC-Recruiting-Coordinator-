import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { createDb } from "@/lib/db";
import { createGuestDemo, createProgram, GUEST_EMAIL_DOMAIN } from "@/lib/onboarding";
import { addNote, createSource, getOrg, listAthletes, setFollow, type Ctx } from "@/lib/repo";
import { ingestRecords } from "@/lib/ingest";
import { logContact } from "@/lib/repo/contacts";
import { boardCsv, csvCell } from "@/lib/export";
import { preparePhoto, readRosterPhotos } from "@/lib/import/photo";
import { confirmImport, stageImport } from "@/lib/import/service";
import { guessMapping } from "@/lib/import/mapping";
import { aiAccess } from "@/lib/agent/entitlement";
import type { AgentClient } from "@/lib/agent/crm-agent";

async function setup() {
  const db = await createDb({ sqlitePath: ":memory:", url: "" });
  const p = await createProgram(db, { programName: "Adopt U", campusLocation: "92069", coachName: "Coach Ray", email: `c${Math.random()}@adopt.test`, password: "password123" });
  const ctx: Ctx = { db, orgId: p.orgId, userId: p.userId, role: "head_coach" };
  return { db, ctx };
}

function fakeVision(answer: unknown): AgentClient & { calls: Anthropic.Beta.MessageCreateParamsNonStreaming[] } {
  const calls: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  return {
    calls,
    beta: { messages: { async create(params) {
      calls.push(params);
      return { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: JSON.stringify(answer) }], stop_reason: "end_turn", usage: { input_tokens: 3000, output_tokens: 400 } } as unknown as Anthropic.Beta.BetaMessage;
    } } },
  };
}

describe("snap a roster", () => {
  it("reads a photo into the normal import preview, logs cost, and never counts against AI checks", async () => {
    const { db, ctx } = await setup();
    const jpg = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#fff" } }).jpeg().toBuffer();
    const client = fakeVision({
      headers: ["#", "Name", "Pos", "Grad", "HS", "Notes"],
      rows: [["7", "Marcus Bell", "SS", "2027", "Vista HS", "92 FB? call dad"], ["12", "Eli Ortiz", "C", "", "Torrey Pines", ""], ["", "", "", "", "", ""]],
      problem: "",
    });
    const table = await readRosterPhotos(db, ctx.orgId, [{ bytes: jpg, mediaType: "image/jpeg" }], { client });
    expect(table.rows).toHaveLength(2); // the blank row is dropped
    expect(table.rows[1][3]).toBe(""); // unreadable stays blank, never guessed
    const sent = client.calls[0].messages[0].content as Anthropic.Beta.BetaContentBlockParam[];
    expect(sent.some((b) => b.type === "image")).toBe(true);

    const id = await stageImport(ctx, "Photo list", table);
    const res = await confirmImport(ctx, id, guessMapping(table.headers, table.rows));
    expect(res.newPlayers).toBe(2);
    expect(res.notesAdded).toBe(1); // handwritten note kept as a coach note
    expect((await listAthletes(db, ctx.orgId)).map((a) => a.lastName).sort()).toEqual(["Bell", "Ortiz"]);

    const run = await db.get<{ status: string; cost_cents: number }>("SELECT status, cost_cents FROM agent_runs WHERE org_id = ?", [ctx.orgId]);
    expect(run?.status).toBe("photo_import");
    expect(Number(run?.cost_cents)).toBeGreaterThan(0);
    expect((await aiAccess(db, await getOrg(db, ctx.orgId))).usedThisMonth).toBe(0);
  });

  it("explains what went wrong instead of inventing rows", async () => {
    const { db, ctx } = await setup();
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } }).png().toBuffer();
    await expect(readRosterPhotos(db, ctx.orgId, [{ bytes: png, mediaType: "image/png" }], { client: fakeVision({ headers: [], rows: [], problem: "This is a photo of a dog, not a list." }) })).rejects.toThrow(/dog/);
    await expect(readRosterPhotos(db, ctx.orgId, [{ bytes: png, mediaType: "image/png" }], { client: null })).rejects.toThrow(/CSV or Excel/);
  });

  it("converts formats the AI can't read (and big photos) to JPEG", async () => {
    const tiff = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#888" } }).tiff().toBuffer();
    const out = await preparePhoto(tiff, "image/tiff");
    expect(out.mediaType).toBe("image/jpeg");
    expect((await sharp(out.data).metadata()).width).toBe(2400);
    await expect(preparePhoto(Buffer.from("not an image"), "image/heic")).rejects.toThrow(/Couldn't open that photo/);
  });
});

describe("download my board", () => {
  it("exports every board player with status, contact, notes and sourced numbers, safely", async () => {
    const { db, ctx } = await setup();
    const src = await createSource(db, ctx.orgId, { providerId: "manual", name: "Seen by Coach", kind: "manual", status: "connected" });
    await ingestRecords(db, ctx.orgId, src, [
      { firstName: "Jordan", lastName: "Pike", gradYear: 2027, primaryPosition: "SS", highSchool: "Mission Hills HS", city: "San Marcos", state: "CA", email: "jp@x.test", metrics: [{ key: "exit_velo_mph", value: 94, measuredAt: "2026-10-01", verification: "unverified" }] },
      { firstName: "=HYPERLINK(\"x\")", lastName: "Hack", gradYear: 2027 },
    ], { isDemo: false, sport: "baseball" });
    const [a, b] = await listAthletes(db, ctx.orgId);
    const pike = a.lastName === "Pike" ? a : b;
    const hack = a.lastName === "Pike" ? b : a;
    await setFollow(ctx, pike.id, true);
    await setFollow(ctx, hack.id, true);
    await addNote(ctx, pike.id, "Great hands, \"plus\" arm");
    await logContact(ctx, pike.id, { kind: "call", occurredAt: "2026-11-01" });

    const { csv, count } = await boardCsv(db, ctx.orgId);
    expect(count).toBe(2);
    expect(csv.startsWith("﻿")).toBe(true);
    const pikeLine = csv.split("\r\n").find((l) => l.includes("Pike"))!;
    expect(pikeLine).toContain("Mission Hills HS");
    expect(pikeLine).toContain("jp@x.test");
    expect(pikeLine).toContain("Called 2026-11-01 (Coach Ray)");
    expect(pikeLine).toContain('Great hands, ""plus"" arm');
    expect(csv).toMatch(/Seen by Coach · 2026-10-01/);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`); // can't run as a formula
    expect(csvCell("-12")).toBe("-12");
    expect(csvCell("@cmd")).toBe("'@cmd");
  });
});

describe("try RC now", () => {
  it("opens a private demo with sample players and stops AI from researching fictional players", async () => {
    const db = await createDb({ sqlitePath: ":memory:", url: "" });
    const g1 = await createGuestDemo(db);
    const g2 = await createGuestDemo(db);
    expect(g1.orgId).not.toBe(g2.orgId);
    const org = await getOrg(db, g1.orgId);
    expect(org.isDemo).toBe(true);
    expect((await listAthletes(db, g1.orgId)).length).toBeGreaterThan(5);
    expect((await aiAccess(db, org)).canRun).toBe(false);
    const guests = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE email LIKE ?", [`%@${GUEST_EMAIL_DOMAIN}`]);
    expect(Number(guests?.n)).toBe(4);
    process.env.RC_GUEST_DEMOS_PER_HOUR = "2";
    await expect(createGuestDemo(db)).rejects.toThrow(/few minutes/);
    delete process.env.RC_GUEST_DEMOS_PER_HOUR;
  });
});
