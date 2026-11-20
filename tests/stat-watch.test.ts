// Season stat monitor, tested against a real local web server.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";

process.env.RC_WATCH_MIN_INTERVAL_MS = "0";

const statsPage = (avg: string, hr: number, era: string) => `<!doctype html><html><head><title>Jordan Pike 2026 Baseball Stats</title></head><body>
<h2>Batting</h2>
<table><tr><th>Season</th><th>GP</th><th>AB</th><th>AVG</th><th>OBP</th><th>SLG</th><th>H</th><th>HR</th><th>RBI</th><th>SB</th></tr>
<tr><td>2025</td><td>24</td><td>70</td><td>.290</td><td>.360</td><td>.410</td><td>20</td><td>1</td><td>9</td><td>4</td></tr>
<tr><td>2026</td><td>12</td><td>40</td><td>${avg}</td><td>.420</td><td>.550</td><td>14</td><td>${hr}</td><td>11</td><td>6</td></tr>
<tr><td>Career</td><td>36</td><td>110</td><td>.310</td><td>.380</td><td>.460</td><td>34</td><td>4</td><td>20</td><td>10</td></tr></table>
<h2>Pitching</h2>
<table><tr><th>Season</th><th>IP</th><th>ERA</th><th>SO</th><th>BB</th><th>WHIP</th></tr><tr><td>2026</td><td>23.2</td><td>${era}</td><td>31</td><td>8</td><td>1.10</td></tr></table>
</body></html>`;

let state = { avg: ".333", hr: 2, era: "2.15" };
let hits: string[] = [];
let server: http.Server;
let base = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push(req.url ?? "");
    const ua = String(req.headers["user-agent"] ?? "");
    if (!ua.startsWith("RC-RecruitingCoordinator")) { res.writeHead(400); return res.end(); }
    if (req.url === "/robots.txt") { res.writeHead(200, { "content-type": "text/plain" }); return res.end("User-agent: *\nDisallow: /private/\nAllow: /\n"); }
    if (req.url === "/private/player") { res.writeHead(200); return res.end(statsPage(".999", 9, "0.00")); }
    if (req.url === "/login-wall") { res.writeHead(200, { "content-type": "text/html" }); return res.end('<form><input type="password" name="p"></form>'); }
    if (req.url === "/no-stats") { res.writeHead(200, { "content-type": "text/html" }); return res.end("<p>Player bio only.</p>"); }
    if (req.url === "/next-data") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { player: { name: "X", stats: { battingAverage: ".301", homeRuns: 3, rbi: 12, stolenBases: 5 } } } } })}</script>`);
    }
    if (req.url === "/player") {
      const etag = `"${state.avg}-${state.hr}-${state.era}"`;
      if (req.headers["if-none-match"] === etag) { res.writeHead(304); return res.end(); }
      res.writeHead(200, { "content-type": "text/html", etag });
      return res.end(statsPage(state.avg, state.hr, state.era));
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  // safeUrl requires a dotted hostname, so use 127.0.0.1 (an IP has dots).
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

describe("stat extraction", () => {
  it("reads this season's row (not career, not last year) from batting and pitching tables", async () => {
    const { extractStats } = await import("@/lib/watch/extract");
    const ex = extractStats(statsPage(".333", 2, "2.15"));
    const v = Object.fromEntries(ex.stats.map((s) => [s.key, s.value]));
    expect(ex.method).toBe("table");
    expect(ex.season).toBe("2026");
    expect(v).toMatchObject({ avg: 0.333, obp: 0.42, slg: 0.55, hits: 14, hr: 2, rbi: 11, sb: 6, ip: 23.2, era: 2.15, k_pitch: 31, bb_pitch: 8, whip: 1.1 });
  });
  it("reads embedded page data when there are no tables", async () => {
    const { extractStats } = await import("@/lib/watch/extract");
    const ex = extractStats(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ stats: { battingAverage: ".301", homeRuns: 3, rbi: 12 } })}</script>`);
    expect(ex.method).toBe("embedded-json");
    expect(Object.fromEntries(ex.stats.map((s) => [s.key, s.value]))).toMatchObject({ avg: 0.301, hr: 3, rbi: 12 });
  });
  it("refuses impossible values instead of recording them", async () => {
    const { extractStats } = await import("@/lib/watch/extract");
    const ex = extractStats("<table><tr><th>Season</th><th>AVG</th><th>HR</th></tr><tr><td>2026</td><td>1.450</td><td>3</td></tr></table>");
    expect(ex.stats.find((s) => s.key === "avg")).toBeUndefined();
    expect(ex.notes.join(" ")).toMatch(/looks wrong/);
  });
});

describe("robots.txt", () => {
  it("parses rules with wildcards and longest-match precedence", async () => {
    const { parseRobots, robotsAllows } = await import("@/lib/watch/fetcher");
    const r = parseRobots("User-agent: *\nDisallow: /stats/\nAllow: /stats/public/\nDisallow: /*?print=1$\nCrawl-delay: 5");
    expect(robotsAllows(r, "/stats/123")).toBe(false);
    expect(robotsAllows(r, "/stats/public/123")).toBe(true);
    expect(robotsAllows(r, "/athlete?print=1")).toBe(false);
    expect(r.crawlDelayMs).toBe(5000);
    expect(robotsAllows(parseRobots("User-agent: *\nDisallow: /"), "/anything")).toBe(false);
  });
});

describe("season stat monitor (end to end)", () => {
  it("links a page, reads stats, detects a change mid-season, and reports it", async () => {
    const { createDb } = await import("@/lib/db");
    const { createProgram } = await import("@/lib/onboarding");
    const { createSource, listAthletes } = await import("@/lib/repo");
    const { ingestRecords } = await import("@/lib/ingest");
    const { addTrackedPage, checkTrackedPages, listTrackedPages } = await import("@/lib/watch/runner");
    const { getEvidence } = await import("@/lib/services");
    const { resetFetcherState } = await import("@/lib/watch/fetcher");
    resetFetcherState();

    const db = await createDb({ sqlitePath: ":memory:", url: "" });
    const p = await createProgram(db, { programName: "Watch U", campusLocation: "92069", coachName: "C", email: "w@watch.test", password: "password123" });
    const ctx = { db, orgId: p.orgId, userId: p.userId, role: "head_coach" as const };
    const src = await createSource(db, p.orgId, { providerId: "csv_import", name: "roster.csv", kind: "import", status: "connected" });
    await ingestRecords(db, p.orgId, src, [{ firstName: "Jordan", lastName: "Pike", gradYear: 2027, state: "CA" }], { isDemo: false, sport: "baseball" });
    const [a] = await listAthletes(db, p.orgId);

    await addTrackedPage(ctx, a.id, `${base}/player`);
    await expect(addTrackedPage(ctx, a.id, "javascript:alert(1)")).rejects.toThrow(/web address/);

    let r = await checkTrackedPages(db, p.orgId, { force: true });
    expect(r).toMatchObject({ checked: 1, newStats: 12, changedStats: 0, problems: 0 });
    let ev = (await getEvidence(db, p.orgId, a.id))!;
    expect(ev.metrics.get("avg")!.primary.value).toBe(0.333);
    expect(ev.metrics.get("avg")!.primary.sourceName).toBe("127.0.0.1 (public page)");
    expect(ev.metrics.get("avg")!.primary.sourceUrl).toBe(`${base}/player`);
    expect(ev.metrics.get("avg")!.verifiedBadge).toBe(false); // published stats are shown with their source, not as "verified"

    // Nothing changed: conditional request → 304, no new rows, no change events.
    r = await checkTrackedPages(db, p.orgId, { force: true });
    expect(r).toMatchObject({ unchanged: 1, changedStats: 0 });

    // Two more games: average and home runs change.
    state = { avg: ".350", hr: 3, era: "2.15" };
    r = await checkTrackedPages(db, p.orgId, { force: true });
    expect(r.changedStats).toBe(2);
    ev = (await getEvidence(db, p.orgId, a.id))!;
    expect(ev.metrics.get("avg")!.primary.value).toBe(0.35);
    expect(ev.metrics.get("avg")!.observations.length).toBeGreaterThanOrEqual(1);
    const events = await db.all<{ message: string }>("SELECT message FROM events WHERE org_id = ? AND type = 'metric_updated'", [p.orgId]);
    expect(events.map((e) => e.message)).toEqual(expect.arrayContaining(["Jordan Pike: Batting avg .333 → .350 (127.0.0.1)", "Jordan Pike: Home runs 2 → 3 (127.0.0.1)"]));

    // Not due yet → skipped without force (polite schedule).
    r = await checkTrackedPages(db, p.orgId);
    expect(r.checked).toBe(0);
    expect((await listTrackedPages(db, p.orgId))[0].status).toBe("ok");
  });

  it("respects robots.txt, never logs in, and reports pages without stats", async () => {
    const { createDb } = await import("@/lib/db");
    const { createProgram } = await import("@/lib/onboarding");
    const { createSource, listAthletes } = await import("@/lib/repo");
    const { ingestRecords } = await import("@/lib/ingest");
    const { addTrackedPage, checkTrackedPages, listTrackedPages } = await import("@/lib/watch/runner");
    const db = await createDb({ sqlitePath: ":memory:", url: "" });
    const p = await createProgram(db, { programName: "Watch U2", coachName: "C", email: "w2@watch.test", password: "password123" });
    const ctx = { db, orgId: p.orgId, userId: p.userId, role: "head_coach" as const };
    const src = await createSource(db, p.orgId, { providerId: "csv_import", name: "r.csv", kind: "import", status: "connected" });
    await ingestRecords(db, p.orgId, src, [{ firstName: "Sam", lastName: "Ruiz", gradYear: 2027 }], { isDemo: false, sport: "baseball" });
    const [a] = await listAthletes(db, p.orgId);
    hits = [];
    for (const path of ["/private/player", "/login-wall", "/no-stats"]) await addTrackedPage(ctx, a.id, base + path);
    const r = await checkTrackedPages(db, p.orgId, { force: true });
    expect(r.problems).toBe(3);
    const byUrl = Object.fromEntries((await listTrackedPages(db, p.orgId)).map((t) => [t.url.replace(base, ""), t.status]));
    expect(byUrl).toEqual({ "/private/player": "blocked_by_robots", "/login-wall": "login_required", "/no-stats": "no_stats" });
    expect(hits).not.toContain("/private/player"); // never even requested
    const n = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM metric_observations WHERE org_id = ?", [p.orgId]);
    expect(Number(n!.n)).toBe(0);
  });
});

describe("linking a whole roster by CSV", () => {
  it("a profile_url column links each player's page for automatic tracking", async () => {
    const { createDb } = await import("@/lib/db");
    const { createProgram } = await import("@/lib/onboarding");
    const { createSource } = await import("@/lib/repo");
    const { ingestRecords } = await import("@/lib/ingest");
    const { parseAthleteCsv } = await import("@/lib/providers/csv");
    const { listTrackedPages } = await import("@/lib/watch/runner");
    const db = await createDb({ sqlitePath: ":memory:", url: "" });
    const p = await createProgram(db, { programName: "CSV U", coachName: "C", email: "csv@watch.test", password: "password123" });
    const src = await createSource(db, p.orgId, { providerId: "csv_import", name: "roster.csv", kind: "import", status: "connected" });
    const csv = "first_name,last_name,grad_year,profile_url\nAna,Lopez,2027,https://www.maxpreps.com/ca/x/ana-lopez/stats/\nBo,Kim,2028,javascript:alert(1)\n";
    await ingestRecords(db, p.orgId, src, parseAthleteCsv(csv).records, { isDemo: false, sport: "baseball" });
    const pages = await listTrackedPages(db, p.orgId);
    expect(pages).toHaveLength(1);
    expect(pages[0].site).toBe("MaxPreps");
  });
});
