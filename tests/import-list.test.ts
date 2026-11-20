import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createDb } from "@/lib/db";
import { createProgram } from "@/lib/onboarding";
import { guessMapping, applyMapping, googleSheetCsvUrl, normalizePositions, parseGradYear } from "@/lib/import/mapping";
import { readUpload, readGoogleSheet, stageImport, getStagedImport, confirmImport } from "@/lib/import/service";
import { listAthletes, listFollows, listNotes } from "@/lib/repo";
import { listTrackedPages } from "@/lib/watch/runner";
import { getEvidence } from "@/lib/services";

describe("matching a coach's own columns", () => {
  it("recognizes common spreadsheet headers", () => {
    const m = guessMapping(["Player", "Pos", "Grad", "HS", "Ht", "Wt", "EV", "60", "Priority", "MaxPreps", "Notes", "Cell", "Random"]);
    expect(m).toEqual(["full_name", "position", "grad_year", "high_school", "height", "weight", "exit_velo", "sixty", "status", "profile_url", "notes", "phone", "ignore"]);
  });
  it("spots unlabeled link columns by their contents", () => {
    const m = guessMapping(["Name", "Col B", "Col C"], [["A B", "https://www.maxpreps.com/x", "https://youtu.be/abc"]]);
    expect(m).toEqual(["full_name", "profile_url", "film_url"]);
  });
  it("reads positions and grad years the way coaches write them", () => {
    expect(normalizePositions("RHP/SS")).toEqual(["RHP", "SS"]);
    expect(normalizePositions("Shortstop")).toEqual(["SS"]);
    expect(parseGradYear("'27")).toBe(2027);
    expect(parseGradYear("Class of 2028")).toBe(2028);
    expect(parseGradYear("Sr")).toBeNull();
  });
  it("never invents values it can't read", () => {
    const r = applyMapping(["Name", "Ht"], [["Eli Brooks", "tall"]], ["full_name", "height"], "List");
    expect(r.rows[0].record.metrics).toEqual([]);
    expect(r.warnings[0]).toMatch(/couldn't be read/);
  });
  it("builds Google Sheets export links", () => {
    expect(googleSheetCsvUrl("https://docs.google.com/spreadsheets/d/abc_123/edit#gid=456")).toBe("https://docs.google.com/spreadsheets/d/abc_123/export?format=csv&gid=456");
    expect(googleSheetCsvUrl("https://example.com/x")).toBeNull();
  });
});

describe("importing an Excel recruiting board end to end", () => {
  it("adds players to My Players with board status, notes, numbers and tracked stat links", async () => {
    const db = await createDb({ sqlitePath: ":memory:", url: "" });
    const p = await createProgram(db, { programName: "List U", campusLocation: "92069", coachName: "C", email: "list@test.demo", password: "password123" });
    const ctx = { db, orgId: p.orgId, userId: p.userId, role: "head_coach" as const };
    const table = await readUpload("coach-list.xlsx", readFileSync("tests/fixtures/coach-list.xlsx"));
    expect(table.headers[0]).toBe("Player"); // skipped the title row
    expect(table.rows).toHaveLength(3); // skipped the blank row
    const id = await stageImport(ctx, "2027 Board", table);
    const staged = (await getStagedImport(db, p.orgId, id))!;
    const r = await confirmImport(ctx, id, staged.suggested);
    expect(r).toMatchObject({ imported: 3, newPlayers: 3, linksTracked: 1 });
    expect(r.warnings.join()).toMatch(/Ht/);

    const athletes = await listAthletes(db, p.orgId);
    const jordan = athletes.find((a) => a.firstName === "Jordan")!;
    const sam = athletes.find((a) => a.firstName === "Sam")!;
    expect(sam.lastName).toBe("Ruiz"); // "Ruiz, Sam"
    expect(jordan).toMatchObject({ primaryPosition: "SS", secondaryPosition: "2B", gradYear: 2027, highSchool: "Mission Hills HS" });
    const status = Object.fromEntries((await listFollows(db, p.orgId)).map((f) => [f.athlete_id, f.board_status]));
    expect(status[jordan.id]).toBe("priority");
    expect(status[sam.id]).toBe("evaluating");
    expect(status[athletes.find((a) => a.firstName === "Eli")!.id]).toBe("not_a_fit");
    const notes = await listNotes(db, p.orgId, jordan.id);
    expect(notes[0].body).toContain("Quick hands");
    expect(notes[0].body).toContain("760-555-0101");
    const ev = (await getEvidence(db, p.orgId, jordan.id))!;
    expect(ev.metrics.get("height_in")!.primary.value).toBe(71);
    expect(ev.metrics.get("exit_velo_mph")!.primary.sourceName).toBe("2027 Board (your list)");
    expect((await listTrackedPages(db, p.orgId)).map((t) => t.site)).toEqual(["MaxPreps"]);
    // Re-importing the same list doesn't duplicate players or notes.
    const id2 = await stageImport(ctx, "2027 Board", table);
    const r2 = await confirmImport(ctx, id2, staged.suggested);
    expect(r2.newPlayers).toBe(0);
    expect((await listAthletes(db, p.orgId)).length).toBe(3);
    expect((await listNotes(db, p.orgId, jordan.id)).length).toBe(1);
  });
  it("explains how to fix a private Google Sheet", async () => {
    const fakeFetch = (async () => new Response("<html>Sign in</html>", { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch;
    await expect(readGoogleSheet("https://docs.google.com/spreadsheets/d/abc/edit", fakeFetch)).rejects.toThrow(/Anyone with the link/);
    const csvFetch = (async () => new Response("Name,Pos\nAl Diaz,SS\n", { status: 200, headers: { "content-type": "text/csv" } })) as typeof fetch;
    expect((await readGoogleSheet("https://docs.google.com/spreadsheets/d/abc/edit", csvFetch)).rows).toEqual([["Al Diaz", "SS"]]);
  });
});
