import { describe, expect, it } from "vitest";
import { createDb } from "@/lib/db";
import { createProgram } from "@/lib/onboarding";
import { createSource, getAthlete, listAthletes, type Ctx } from "@/lib/repo";
import { ingestRecords } from "@/lib/ingest";
import { classifyUrl, decideCandidates, findPlayerPages, listCandidates, listLinks, playersNeedingSearch, scoreResult } from "@/lib/finder/finder";
import { getSearchProvider, type SearchProvider } from "@/lib/finder/search";
import { decideApproval, listApprovals } from "@/lib/repo/approvals";
import { listTrackedPages } from "@/lib/watch/runner";

const jordan = { firstName: "Jordan", lastName: "Pike", gradYear: 2027, highSchool: "Mission Hills High School", city: "San Marcos", state: "CA", primaryPosition: "SS" };

describe("classifying links", () => {
  it("recognizes player pages and ignores search/home pages", () => {
    expect(classifyUrl("https://www.maxpreps.com/ca/san-marcos/mission-hills-grizzlies/athletes/jordan-pike/?careerid=abc")).toEqual({ site: "MaxPreps", kind: "stats" });
    expect(classifyUrl("https://www.perfectgame.org/Players/Playerprofile.aspx?ID=123")).toEqual({ site: "Perfect Game", kind: "stats" });
    expect(classifyUrl("https://x.com/jpike_27")).toEqual({ site: "X", kind: "social" });
    expect(classifyUrl("https://www.instagram.com/jordanpike/")).toEqual({ site: "Instagram", kind: "social" });
    expect(classifyUrl("https://www.hudl.com/profile/12345/Jordan-Pike")).toEqual({ site: "Hudl", kind: "film" });
    expect(classifyUrl("https://x.com/search?q=jordan")).toBeNull();
    expect(classifyUrl("https://www.maxpreps.com/")).toBeNull();
    expect(classifyUrl("https://www.facebook.com/jordan")).toBeNull();
  });
});

describe("scoring search results", () => {
  it("needs the name and rewards school/class/town matches", () => {
    const good = scoreResult(jordan, { url: "https://www.maxpreps.com/x/athletes/jordan-pike/", title: "Jordan Pike's Mission Hills Baseball Stats", snippet: "Jordan Pike, Class of 2027, San Marcos, CA" });
    expect(good.score).toBeGreaterThanOrEqual(0.9);
    expect(good.reasons.join()).toMatch(/School matches.*|Class of 2027/);
    expect(scoreResult(jordan, { url: "https://x.com/jpike", title: "Jordan Smith", snippet: "" }).score).toBe(0);
    expect(scoreResult(jordan, { url: "https://x.com/cpike", title: "Chris Pike", snippet: "baseball" }).score).toBeLessThan(0.6);
  });
});

function fakeSearch(results: Record<string, Array<{ url: string; title: string; snippet: string }>>): SearchProvider & { calls: string[] } {
  const calls: string[] = [];
  return { name: "Fake", calls, async search(q) { calls.push(q); return q.includes("site:maxpreps") ? results.stats ?? [] : results.social ?? []; } };
}

describe("finding a player's pages end to end", () => {
  it("queues only likely matches for approval; kept pages become tracked/linked; dismissed are never suggested again", async () => {
    const db = await createDb({ sqlitePath: ":memory:", url: "" });
    const p = await createProgram(db, { programName: "Find U", campusLocation: "92069", coachName: "C", email: "f@find.test", password: "password123" });
    const ctx: Ctx = { db, orgId: p.orgId, userId: p.userId, role: "head_coach" };
    const src = await createSource(db, p.orgId, { providerId: "manual", name: "Seen by C", kind: "manual", status: "connected" });
    await ingestRecords(db, p.orgId, src, [{ ...jordan }], { isDemo: false, sport: "baseball" });
    const [a] = await listAthletes(db, p.orgId);
    const provider = fakeSearch({
      stats: [
        { url: "https://www.maxpreps.com/ca/san-marcos/mission-hills/athletes/jordan-pike/", title: "Jordan Pike Mission Hills Baseball", snippet: "Class of 2027 · San Marcos, CA" },
        { url: "https://www.maxpreps.com/tx/x/athletes/jordan-pike-2/", title: "Jordan Pike football", snippet: "Houston, TX" }, // weaker: no school/class/town
        { url: "https://www.maxpreps.com/search/?q=jordan+pike", title: "Search", snippet: "" },
      ],
      social: [
        { url: "https://x.com/jpike_27", title: "Jordan Pike (@jpike_27)", snippet: "SS | Mission Hills '27 | San Marcos baseball" },
        { url: "https://www.instagram.com/pike.jordan/", title: "Jordan Pike", snippet: "Mission Hills baseball 2027" },
        { url: "https://x.com/somebodyelse", title: "Alex Rivera", snippet: "baseball" },
      ],
    });
    const r = await findPlayerPages(db, p.orgId, a.id, { provider });
    expect(provider.calls).toHaveLength(2);
    const cands = await listCandidates(db, p.orgId, { athleteId: a.id });
    expect(cands.map((c) => c.site).sort()).toEqual(["Instagram", "MaxPreps", "X"]);
    expect(r.candidates).toBe(3);
    const approval = (await listApprovals(db, p.orgId)).find((x) => x.kind === "links_found")!;
    expect(approval.title).toMatch(/3 pages found for Jordan Pike/);

    // Coach keeps MaxPreps + X, dismisses Instagram.
    const keep = cands.filter((c) => c.site !== "Instagram").map((c) => c.id);
    const res = await decideApproval(ctx, approval.id, { decision: "approve", acceptIds: keep });
    expect(res.result).toMatch(/Kept 2 pages, dismissed 1/);
    expect((await listTrackedPages(db, p.orgId, a.id)).map((t) => t.site)).toEqual(["MaxPreps"]);
    expect((await listLinks(db, p.orgId, a.id)).map((l) => l.site)).toEqual(["X"]);
    expect((await getAthlete(db, p.orgId, a.id))!.xHandle).toBe("jpike_27");

    // Searching again suggests nothing already decided.
    const again = await findPlayerPages(db, p.orgId, a.id, { provider });
    expect(again.candidates).toBe(0);
    expect(await playersNeedingSearch(db, p.orgId, [a.id], 5)).toEqual([]);
  });
  it("reports honestly when no search service is connected, and never searches opted-out players", async () => {
    expect(getSearchProvider({})).toBeNull();
    const db = await createDb({ sqlitePath: ":memory:", url: "" });
    const p = await createProgram(db, { programName: "Find U2", coachName: "C", email: "f2@find.test", password: "password123" });
    const src = await createSource(db, p.orgId, { providerId: "manual", name: "m", kind: "manual", status: "connected" });
    await ingestRecords(db, p.orgId, src, [{ ...jordan }], { isDemo: false, sport: "baseball" });
    const [a] = await listAthletes(db, p.orgId);
    expect((await findPlayerPages(db, p.orgId, a.id, { provider: null })).note).toMatch(/No search service/);
    await db.run("UPDATE athletes SET opted_out = 1 WHERE id = ?", [a.id]);
    const provider = fakeSearch({});
    expect((await findPlayerPages(db, p.orgId, a.id, { provider })).note).toMatch(/opted out/);
    expect(provider.calls).toHaveLength(0);
  });
  it("calls the real search APIs with the right request shape", async () => {
    let seen = "";
    const fake = (async (u: string | URL | Request, init?: RequestInit) => {
      seen = `${String(u)} ${JSON.stringify(init?.headers ?? {})}`;
      return new Response(JSON.stringify({ web: { results: [{ url: "https://x.com/a", title: "A", description: "<b>b</b>" }] } }), { status: 200 });
    }) as typeof fetch;
    const brave = getSearchProvider({ BRAVE_SEARCH_API_KEY: "k" }, fake)!;
    expect(await brave.search("jordan pike")).toEqual([{ url: "https://x.com/a", title: "A", snippet: "b" }]);
    expect(seen).toMatch(/api\.search\.brave\.com.*X-Subscription-Token/);
  });
});
