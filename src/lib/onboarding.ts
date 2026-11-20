// Creating programs. A real program starts EMPTY: no athletes until the coach
// imports authorized data or connects a licensed provider. A demo workspace
// is clearly flagged and is the only place fictional fixtures ever load.

import { Db, newId, nowIso } from "./db";
import { createUser } from "./auth";
import { geocode } from "./domain/geo";
import { defaultCriteria } from "./domain/criteria";
import { PROVIDERS } from "./providers/registry";
import { createMission, createSource, saveProfile, sanitizeBranding, updateOrgSettings, type Branding, type Ctx } from "./repo";
import type { Role } from "./domain/types";
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

export interface DemoConfig {
  programName: string; // e.g. "Palomar College Baseball (DEMO)"
  teamName?: string; // header name, e.g. "Palomar Baseball"
  campusZip: string;
  branding?: Partial<Branding>;
  /** First person is the account the demo opens as. */
  staff: Array<{ name: string; title: string; role: Role; email: string }>;
  password: string;
  profile?: { name: string; gradYears: number[]; positions: string[]; radiusMi: number };
  campName?: string;
}

/**
 * Builds a clearly-labeled demo workspace for a program: its campus, colors,
 * logo and staff accounts, with FICTIONAL players from real towns near campus.
 * Runs the first search mission for real so the demo opens with work done.
 */
export async function createDemoProgram(db: Db, cfg: DemoConfig) {
  const [lead, ...rest] = cfg.staff;
  const { orgId, userId } = await createProgram(db, {
    programName: cfg.programName,
    campusLocation: cfg.campusZip,
    coachName: lead.name,
    coachTitle: lead.title,
    email: lead.email,
    password: cfg.password,
    isDemo: true,
  });
  if (lead.role !== "head_coach") await db.run("UPDATE users SET role = ? WHERE id = ?", [lead.role, userId]);
  for (const st of rest) await createUser(db, orgId, { ...st, password: cfg.password });
  for (const prov of PROVIDERS.filter((x) => x.kind === "demo")) {
    await createSource(db, orgId, { providerId: prov.id, name: prov.name, kind: "demo", status: "connected", statusDetail: "Demonstration data — all athletes are fictional.", config: { campusZip: cfg.campusZip } });
  }
  const ctx: Ctx = { db, orgId, userId, role: "head_coach" };
  if (cfg.branding || cfg.teamName) await updateOrgSettings(ctx, { branding: sanitizeBranding({ ...cfg.branding, teamName: cfg.teamName ?? null }), programDisplayName: cfg.teamName });
  const campus = geocode(cfg.campusZip)!;
  const p = cfg.profile ?? { name: "2027–28 Shortstops near campus", gradYears: [2027, 2028], positions: ["SS"], radiusMi: 150 };
  const criteria = {
    ...defaultCriteria(),
    gradYears: p.gradYears,
    positions: p.positions,
    location: { mode: "radius" as const, center: { label: `Campus (${campus.label})`, lat: campus.lat, lng: campus.lng }, radiusMi: p.radiusMi },
    metrics: [
      { key: "height_in", op: "gte" as const, value: 70, importance: "required" as const },
      { key: "weight_lb", op: "gte" as const, value: 170, importance: "required" as const },
      { key: "exit_velo_mph", op: "gte" as const, value: 88, importance: "required" as const, verifiedOnly: true },
      { key: "sixty_yd_sec", op: "lte" as const, value: 7.1, importance: "preferred" as const },
    ],
  };
  const profileId = await saveProfile(ctx, p.name, criteria);
  const campStart = new Date(Date.now() + 45 * 86_400_000);
  campStart.setUTCHours(17, 0, 0, 0);
  const campId = await createCamp(ctx, { name: cfg.campName ?? "Winter Prospect Camp (demo)", startsAt: campStart.toISOString(), location: `Campus field (${campus.label})`, registrationUrl: null, profileId });
  const missionId = await createMission(ctx, { profileId, name: `${p.name} — daily`, schedule: "daily", actions: { discover: true, monitorGames: true, prepareCampInvites: true, campId } });
  await runMission(db, orgId, missionId, "manual");
  return { orgId, userId };
}

/** Generic demo used by the sign-up page. */
export async function createDemoWorkspace(db: Db, email: string, password: string, coachName = "Demo Coach") {
  return createDemoProgram(db, {
    programName: "Demo State University (DEMO — fictional data)",
    teamName: "Demo State Baseball",
    campusZip: "78712",
    staff: [{ name: coachName, title: "Head Baseball Coach (demo)", role: "head_coach", email }],
    password,
  });
}
