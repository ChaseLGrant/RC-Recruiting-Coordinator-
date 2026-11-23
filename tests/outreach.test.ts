import { describe, expect, it } from "vitest";
import { createDb } from "@/lib/db";
import { getOrg, listAthletes, listUsers } from "@/lib/repo";
import { acceptInvite } from "@/lib/billing/schools";
import { importProspects, listProspects, mailMergeCsv, openPreview, prospectForDemo, prospectStatuses, recordVisit, startFromPreview, trackDemoView } from "@/lib/outreach/prospects";
import { purgeOldGuestDemos } from "@/lib/outreach/cleanup";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const fakeFetch = (async (url: string) => url.includes("good")
  ? new Response(PNG, { headers: { "content-type": "image/png" } })
  : new Response("nope", { status: 404 })) as unknown as typeof fetch;

const LIST = `Program,Team,ZIP,Primary color,Secondary color,Accent color,Logo URL,Coach,Email,Conference
Palomar College Baseball,Palomar Baseball,92069,#c8102e,141414,#aaa,https://x.test/good.png,Coach Ben Adams,ben@palomar.test,PCAC
Mesa College Baseball,Mesa Olympians,92111,#00205b,#000000,,/logos/missing.png,Coach Lee,lee@mesa.test,PCAC
Nowhere U,,00000,,,,,,,
`;

describe("outreach to every program", () => {
  it("imports a school list with colors and logos, and gives each a personal link", async () => {
    const db = await createDb({ sqlitePath: ":memory:", url: "" });
    const r = await importProspects(db, LIST, { fetchImpl: fakeFetch, baseUrl: "https://rc.test" });
    expect(r).toMatchObject({ added: 2, updated: 0, logos: 1 });
    expect(r.problems.join(" ")).toMatch(/Mesa.*logo/);
    expect(r.problems.join(" ")).toMatch(/Nowhere U.*ZIP/);
    const [a, b] = await listProspects(db);
    const palomar = [a, b].find((p) => p.programName.startsWith("Palomar"))!;
    expect(palomar.branding).toMatchObject({ primary: "#c8102e", ink: "#141414", accent: "#aaaaaa", teamName: "Palomar Baseball" });
    expect(palomar.branding.logoDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(palomar.slug).toMatch(/^palomar-baseball-[0-9a-f]{6}$/);

    // Re-upload updates the school without changing its link.
    const again = await importProspects(db, LIST.replace("#c8102e", "#b00020"), { fetchImpl: fakeFetch });
    expect(again).toMatchObject({ added: 0, updated: 2 });
    const p2 = (await listProspects(db)).find((p) => p.id === palomar.id)!;
    expect(p2.slug).toBe(palomar.slug);
    expect(p2.branding.primary).toBe("#b00020");
  });

  it("tracks the funnel: clicked → opened demo → explored → signed up → using", async () => {
    const db = await createDb({ sqlitePath: ":memory:", url: "" });
    await importProspects(db, LIST, { fetchImpl: fakeFetch });
    let p = (await listProspects(db)).find((x) => x.programName.startsWith("Palomar"))!;
    const stage = async () => (await prospectStatuses(db, [ (await listProspects(db)).find((x) => x.id === p.id)! ])).get(p.id)!.stage;
    expect(await stage()).toBe("not_opened");
    await recordVisit(db, p.id);
    expect(await stage()).toBe("clicked");

    const demo = await openPreview(db, p.slug);
    const org = await getOrg(db, demo.orgId);
    expect(org.isDemo).toBe(true);
    expect(org.settings.branding).toMatchObject({ primary: "#c8102e", teamName: "Palomar Baseball" });
    expect(org.name).toMatch(/Palomar College Baseball \(DEMO/);
    expect((await listAthletes(db, demo.orgId)).length).toBeGreaterThan(5); // fictional players near their campus
    expect((await prospectForDemo(db, demo.orgId))?.id).toBe(p.id);
    expect(await stage()).toBe("tried");
    for (let i = 0; i < 5; i++) await trackDemoView(db, demo.orgId);
    expect(await stage()).toBe("explored");

    const token = await startFromPreview(db, p.slug);
    p = (await listProspects(db)).find((x) => x.id === p.id)!;
    expect(p.orgId).toBeTruthy();
    const real = await getOrg(db, p.orgId!);
    expect(real.isDemo).toBe(false);
    expect(real.settings.branding.primary).toBe("#c8102e");
    await acceptInvite(db, token, { name: "Ben Adams", email: "ben@palomar.test", password: "coach-pass-1" });
    expect(await stage()).toBe("signed_up");
    expect((await listUsers(db, p.orgId!)).length).toBe(1);
    await expect(startFromPreview(db, p.slug)).rejects.toThrow(/already set up/);

    const csv = mailMergeCsv(await listProspects(db), "https://rc.test", await prospectStatuses(db, await listProspects(db)));
    expect(csv).toContain(`https://rc.test/p/${p.slug}`);
    expect(csv).toMatch(/Coach Ben Adams,Ben,ben@palomar.test/);
    expect(csv).toContain("Signed up");
  });

  it("limits preview opens and cleans up old try-it demos but keeps the counts", async () => {
    const db = await createDb({ sqlitePath: ":memory:", url: "" });
    await importProspects(db, LIST, { fetchImpl: fakeFetch });
    const p = (await listProspects(db))[0];
    process.env.RC_PREVIEWS_PER_SCHOOL_PER_DAY = "1";
    const demo = await openPreview(db, p.slug);
    await expect(openPreview(db, p.slug)).rejects.toThrow(/opened a lot/);
    delete process.env.RC_PREVIEWS_PER_SCHOOL_PER_DAY;
    await expect(openPreview(db, "made-up")).rejects.toThrow(/isn't valid/);

    await db.run("UPDATE orgs SET created_at = '2020-01-01T00:00:00Z' WHERE id = ?", [demo.orgId]);
    expect(await purgeOldGuestDemos(db)).toBe(1);
    expect(await db.get("SELECT id FROM orgs WHERE id = ?", [demo.orgId])).toBeUndefined();
    expect((await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM athletes WHERE org_id = ?", [demo.orgId]))?.n).toBe(0);
    expect((await listProspects(db)).find((x) => x.id === p.id)!.opens).toBe(1);
  });
});
