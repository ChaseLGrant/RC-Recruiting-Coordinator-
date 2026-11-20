import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createDb } from "@/lib/db";
import { createProgram } from "@/lib/onboarding";
import { createSource, listAthletes, type Ctx } from "@/lib/repo";
import { ingestRecords } from "@/lib/ingest";
import { extractSchedule, parseGameDate, parseGameTime } from "@/lib/watch/schedule";
import { formatInZone, timezoneForLocation, zonedToUtc } from "@/lib/domain/time";
import { logContact, deleteContact, listContacts, lastContacts } from "@/lib/repo/contacts";
import { authenticate, createSession, sessionInfo, setActingUser, setSharedLogin, addStaffProfile } from "@/lib/auth";

process.env.RC_WATCH_MIN_INTERVAL_MS = "0";

describe("time zones", () => {
  it("picks the program's zone from campus and converts local game times", () => {
    expect(timezoneForLocation(33.15, -117.18)).toBe("America/Los_Angeles"); // Palomar
    expect(timezoneForLocation(30.28, -97.73)).toBe("America/Chicago");
    // 4:00 PM Pacific on Mar 5 2027 (PST, UTC-8) = 00:00 UTC Mar 6
    expect(zonedToUtc(2027, 3, 5, 16, 0, "America/Los_Angeles")).toBe("2027-03-06T00:00:00.000Z");
    // After DST starts (Mar 14 2027), PDT is UTC-7
    expect(zonedToUtc(2027, 4, 1, 16, 0, "America/Los_Angeles")).toBe("2027-04-01T23:00:00.000Z");
    expect(formatInZone("2027-03-06T00:00:00.000Z", "America/Los_Angeles", { hour: "numeric", minute: "2-digit" })).toBe("4:00 PM");
  });
});

describe("reading schedule pages", () => {
  const now = new Date("2027-02-20T12:00:00Z");
  it("parses dates and times the way schedules print them", () => {
    expect(parseGameDate("Tue 3/5", now)).toEqual({ y: 2027, m: 3, d: 5 });
    expect(parseGameDate("Mar 12", now)).toEqual({ y: 2027, m: 3, d: 12 });
    expect(parseGameDate("2027-04-02", now)).toEqual({ y: 2027, m: 4, d: 2 });
    expect(parseGameTime("3:30 PM")).toEqual({ h: 15, min: 30 });
    expect(parseGameTime("TBA")).toBeNull();
  });
  it("keeps only upcoming games, skips played ones, flags cancellations", () => {
    const html = `<table><tr><th>Date</th><th>Opponent</th><th>Time</th><th>Location</th><th>Result</th></tr>
      <tr><td>2/14</td><td>vs Vista</td><td>3:30 PM</td><td>Home</td><td>W 5-2</td></tr>
      <tr><td>3/5</td><td>@ Carlsbad</td><td>4:00 PM</td><td>Carlsbad, CA</td><td></td></tr>
      <tr><td>3/12</td><td>vs Mission Hills (Postponed)</td><td>3:15 PM</td><td>Home</td><td></td></tr></table>`;
    const { games } = extractSchedule(html, "America/Los_Angeles", now);
    expect(games).toHaveLength(2);
    expect(games[0]).toMatchObject({ opponent: "Carlsbad", home: false, startsAt: "2027-03-06T00:00:00.000Z", status: "scheduled" });
    expect(games[1]).toMatchObject({ opponent: "Mission Hills", home: true, status: "cancelled" });
  });
});

describe("live schedules from linked pages", () => {
  let server: http.Server;
  let base = "";
  let rows = "";
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/robots.txt") { res.writeHead(200); return res.end("User-agent: *\nAllow: /\n"); }
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<table><tr><th>Date</th><th>Opponent</th><th>Time</th></tr>${rows}</table>`);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it("adds games, detects a time change, and flags a game that disappears", async () => {
    const { addTrackedPage, checkTrackedPages } = await import("@/lib/watch/runner");
    const db = await createDb({ sqlitePath: ":memory:", url: "" });
    const p = await createProgram(db, { programName: "Sched U", campusLocation: "92069", coachName: "C", email: "s@sched.test", password: "password123" });
    const ctx: Ctx = { db, orgId: p.orgId, userId: p.userId, role: "head_coach" };
    const src = await createSource(db, p.orgId, { providerId: "csv_import", name: "r.csv", kind: "import", status: "connected" });
    await ingestRecords(db, p.orgId, src, [{ firstName: "Ty", lastName: "Webb", gradYear: 2027, team: "Vista HS" }], { isDemo: false, sport: "baseball" });
    const [a] = await listAthletes(db, p.orgId);
    const next = new Date(Date.now() + 10 * 86_400_000);
    const later = new Date(Date.now() + 17 * 86_400_000);
    const md = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
    rows = `<tr><td>${md(next)}</td><td>vs Oceanside</td><td>3:30 PM</td></tr><tr><td>${md(later)}</td><td>@ Poway</td><td>4:00 PM</td></tr>`;
    await addTrackedPage(ctx, a.id, `${base}/schedule`);
    let r = await checkTrackedPages(db, p.orgId, { force: true });
    expect(r.gamesFound).toBe(2);
    rows = `<tr><td>${md(next)}</td><td>vs Oceanside</td><td>5:00 PM</td></tr>`; // time moved, Poway game removed
    r = await checkTrackedPages(db, p.orgId, { force: true });
    expect(r.gamesChanged).toBe(2);
    const ev = await db.all<{ message: string }>("SELECT message FROM events WHERE org_id = ? AND type = 'schedule_changed'", [p.orgId]);
    expect(ev.map((e) => e.message).join(" | ")).toMatch(/time changed.*\|.*no longer on the schedule|no longer on the schedule.*\|.*time changed/);
  });
});

describe("contact log", () => {
  it("logs contacts under the coach's name, shows the latest, and only lets the author or head coach remove one", async () => {
    const db = await createDb({ sqlitePath: ":memory:", url: "" });
    const p = await createProgram(db, { programName: "Contact U", coachName: "Head Coach", email: "hc@contact.test", password: "password123" });
    const asstId = await addStaffProfile(db, p.orgId, { name: "Asst Coach", title: "Pitching", role: "assistant_coach" });
    const hc: Ctx = { db, orgId: p.orgId, userId: p.userId, role: "head_coach" };
    const asst: Ctx = { db, orgId: p.orgId, userId: asstId, role: "assistant_coach" };
    const src = await createSource(db, p.orgId, { providerId: "csv_import", name: "r.csv", kind: "import", status: "connected" });
    await ingestRecords(db, p.orgId, src, [{ firstName: "Lee", lastName: "Park", gradYear: 2027 }], { isDemo: false, sport: "baseball" });
    const [a] = await listAthletes(db, p.orgId);
    await logContact(asst, a.id, { kind: "call", note: "Talked with dad", occurredAt: "2026-11-10" });
    const textId = await logContact(asst, a.id, { kind: "text" });
    await expect(logContact(asst, a.id, { kind: "smoke_signal" })).rejects.toThrow(/kind of contact/);
    await expect(logContact(asst, a.id, { kind: "call", occurredAt: "2099-01-01" })).rejects.toThrow(/after they happen/);
    const list = await listContacts(db, p.orgId, a.id);
    expect(list.map((c) => c.kind)).toEqual(["text", "call"]);
    expect(list[0].user_name).toBe("Asst Coach");
    expect((await lastContacts(db, p.orgId, [a.id])).get(a.id)!.kind).toBe("text");
    const hcCall = await logContact(hc, a.id, { kind: "camp" });
    await expect(deleteContact(asst, hcCall)).rejects.toThrow(/Only the coach who logged/);
    await deleteContact(hc, textId); // head coach may remove any
    expect((await listContacts(db, p.orgId, a.id)).map((c) => c.kind)).toEqual(["camp", "call"]);
    await expect(logContact({ ...asst, role: "viewer" }, a.id, { kind: "call" })).rejects.toThrow(/does not allow/);
  });
});

describe("one login for the whole staff", () => {
  it("staff sign in with one login, pick their name, and their work is credited to them", async () => {
    const db = await createDb({ sqlitePath: ":memory:", url: "" });
    const p = await createProgram(db, { programName: "Shared U", coachName: "Head Coach", email: "hc@shared.test", password: "password123" });
    const other = await createProgram(db, { programName: "Other U", coachName: "X", email: "x@other.test", password: "password123" });
    const carter = await addStaffProfile(db, p.orgId, { name: "Hayden Carter", title: "Pitching Coach", role: "assistant_coach" });
    await setSharedLogin(db, p.orgId, "staff@shared.test", "team-pass-2026", "Shared Baseball");

    const login = await authenticate(db, "staff@shared.test", "team-pass-2026");
    expect(login?.isShared).toBe(true);
    const { token } = await createSession(db, login!.id);
    expect((await sessionInfo(db, token))!.acting).toBeNull(); // must pick a name first
    await expect(setActingUser(db, token, other.userId)).rejects.toThrow(/your staff/); // can't act as another program's coach
    await setActingUser(db, token, carter);
    const info = (await sessionInfo(db, token))!;
    expect(info.acting!.name).toBe("Hayden Carter");
    expect(info.acting!.role).toBe("assistant_coach");
    // Staff profiles have no password of their own.
    const profileEmail = (await db.get<{ email: string }>("SELECT email FROM users WHERE id = ?", [carter]))!.email;
    expect(await authenticate(db, profileEmail, "")).toBeNull();
    // Changing the staff password keeps one shared account.
    await setSharedLogin(db, p.orgId, "staff@shared.test", "new-team-pass", "Shared Baseball");
    expect(await authenticate(db, "staff@shared.test", "new-team-pass")).not.toBeNull();
    const n = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE org_id = ? AND is_shared = 1", [p.orgId]);
    expect(Number(n!.n)).toBe(1);
  });
});

describe("contact info on linked pages", () => {
  it("suggests the player's own email/phone/X, ignores site and generic addresses, and skips ambiguous pages", async () => {
    const { extractContactInfo } = await import("@/lib/watch/contact-info");
    const page = `<footer><a href="mailto:support@maxpreps.com">Support</a> <a href="https://x.com/maxpreps">X</a></footer>
      <div class="bio">Contact: <a href="mailto:jordan.pike27@gmail.com">jordan.pike27@gmail.com</a> · Cell: (760) 555-0101 · <a href="https://twitter.com/jpike_27">@jpike_27</a></div>`;
    expect(extractContactInfo(page, "https://www.maxpreps.com/ca/x/jordan-pike/")).toEqual({ email: "jordan.pike27@gmail.com", phone: "(760) 555-0101", xHandle: "jpike_27" });
    const roster = `<a href="mailto:a@gmail.com">a</a><a href="mailto:b@gmail.com">b</a><a href="mailto:c@gmail.com">c</a>`;
    expect(extractContactInfo(roster, "https://school.example.edu/roster").email).toBeNull();
  });
  it("normalizes phones and handles", async () => {
    const { normalizePhone, normalizeXHandle } = await import("@/lib/repo");
    expect(normalizePhone("+1 760.555.0101")).toBe("(760) 555-0101");
    expect(normalizePhone("555-0101")).toBeNull();
    expect(normalizeXHandle("https://x.com/jpike_27")).toBe("jpike_27");
    expect(normalizeXHandle("@jpike_27")).toBe("jpike_27");
    expect(normalizeXHandle("not a handle!")).toBeNull();
  });
});
