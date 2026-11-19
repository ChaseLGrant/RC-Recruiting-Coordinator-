// Creating programs. A real program starts EMPTY: no athletes until the coach
// imports authorized data or connects a licensed provider. A demo workspace
// is clearly flagged and is the only place fictional fixtures ever load.

import { Db, newId, nowIso } from "./db";
import { createUser } from "./auth";
import { geocode } from "./domain/geo";
import { defaultCriteria } from "./domain/criteria";
import { PROVIDERS } from "./providers/registry";
import { createMission, createSource, saveProfile, type Ctx } from "./repo";
import { createCamp } from "./repo/approvals";
import { runMission } from "./jobs/runner";

export async function createProgram(
  db: Db,
  p: { programName: string; sport?: string; campusLocation?: string; coachName: string; coachTitle?: string; email: string; password: string; isDemo?: boolean },
): Promise<{ orgId: string; userId: string }> {
  const orgId = newId();
  const campus = p.campusLocation ? geocode(p.campusLocation) : null;
  if (p.campusLocation && !campus) throw new Error(`Couldn't find "${p.campusLocation}". Use a ZIP code or "City, ST".`);
  await db.run("INSERT INTO orgs (id, name, sport, campus_label, campus_lat, campus_lng, is_demo, settings_json, created_at) VALUES (?,?,?,?,?,?,?,?,?)", [
    orgId, p.programName.trim(), p.sport ?? "baseball", campus ? `Campus (${campus.label})` : null, campus?.lat ?? null, campus?.lng ?? null, p.isDemo ? 1 : 0, "{}", nowIso(),
  ]);
  const userId = await createUser(db, orgId, { email: p.email, name: p.coachName, title: p.coachTitle ?? "Head Coach", role: "head_coach", password: p.password });
  // Register every licensed provider so coaches see honest connection status.
  for (const prov of PROVIDERS.filter((x) => x.kind === "licensed_api")) {
    const st = prov.status(process.env, { isDemo: Boolean(p.isDemo) });
    await createSource(db, orgId, { providerId: prov.id, name: prov.name, kind: prov.kind, status: st.status, statusDetail: st.detail });
  }
  return { orgId, userId };
}

/** Sets up a clearly-labeled demo workspace and runs its first mission for real. */
export async function createDemoWorkspace(db: Db, email: string, password: string, coachName = "Demo Coach") {
  const { orgId, userId } = await createProgram(db, {
    programName: "Demo State University (DEMO — fictional data)",
    campusLocation: "78712",
    coachName,
    coachTitle: "Head Baseball Coach (demo)",
    email,
    password,
    isDemo: true,
  });
  for (const prov of PROVIDERS.filter((x) => x.kind === "demo")) {
    await createSource(db, orgId, { providerId: prov.id, name: prov.name, kind: "demo", status: "connected", statusDetail: "Demonstration data — all athletes are fictional." });
  }
  const ctx: Ctx = { db, orgId, userId, role: "head_coach" };
  const campus = geocode("78712")!;
  const criteria = {
    ...defaultCriteria(),
    gradYears: [2027, 2028],
    positions: ["SS"],
    location: { mode: "radius" as const, center: { label: `Campus (${campus.label})`, lat: campus.lat, lng: campus.lng }, radiusMi: 150 },
    metrics: [
      { key: "height_in", op: "gte" as const, value: 70, importance: "required" as const },
      { key: "weight_lb", op: "gte" as const, value: 170, importance: "required" as const },
      { key: "exit_velo_mph", op: "gte" as const, value: 88, importance: "required" as const, verifiedOnly: true },
      { key: "sixty_yd_sec", op: "lte" as const, value: 7.1, importance: "preferred" as const },
    ],
  };
  const profileId = await saveProfile(ctx, "2027–28 Shortstops near campus", criteria);
  const campStart = new Date(Date.now() + 45 * 86_400_000);
  campStart.setUTCHours(15, 0, 0, 0);
  const campId = await createCamp(ctx, { name: "Winter Prospect Camp (demo)", startsAt: campStart.toISOString(), location: "Demo Field, Austin, TX", registrationUrl: null, profileId });
  const missionId = await createMission(ctx, {
    profileId,
    name: "Shortstop discovery + camp targeting",
    schedule: "daily",
    actions: { discover: true, monitorGames: true, prepareCampInvites: true, campId },
  });
  await runMission(db, orgId, missionId, "manual");
  return { orgId, userId };
}
