// Creating programs. A real program starts EMPTY: no athletes until the coach
// imports authorized data or connects a licensed provider. A demo workspace
// is clearly flagged and is the only place fictional fixtures ever load.

import { Db, newId, nowIso } from "./db";
import { addStaffProfile, createUser, setSharedLogin } from "./auth";
import { geocode } from "./domain/geo";
import { defaultCriteria } from "./domain/criteria";
import { PROVIDERS } from "./providers/registry";
import { addNote, createMission, createSource, listUsers, saveProfile, sanitizeBranding, updateOrgSettings, type Branding, type Ctx } from "./repo";
import { decideApproval, listApprovals } from "./repo/approvals";
import { logContact } from "./repo/contacts";
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
  /** Coaching staff. With sharedLogin they sign in with one staff login and tap their name. */
  staff: Array<{ name: string; title: string; role: Role; email?: string }>;
  /** One login for the whole staff. */
  sharedLogin?: { email: string };
  password: string;
  profile?: { name: string; gradYears: number[]; positions: string[]; radiusMi: number };
  campName?: string;
  /** Pre-fill a few followed players, contacts and notes so the demo looks lived-in. */
  seedActivity?: boolean;
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
    email: lead.email ?? `lead-${Date.now()}@staff.rc.local`,
    password: cfg.password,
    isDemo: true,
  });
  if (lead.role !== "head_coach") await db.run("UPDATE users SET role = ? WHERE id = ?", [lead.role, userId]);
  if (cfg.sharedLogin) {
    // Everyone becomes a tap-your-name profile behind one staff login.
    await db.run("UPDATE users SET email = ?, password_hash = '' WHERE id = ?", [`profile-${userId}@staff.rc.local`, userId]);
    for (const st of rest) await addStaffProfile(db, orgId, st);
    await setSharedLogin(db, orgId, cfg.sharedLogin.email, cfg.password, cfg.teamName ?? cfg.programName);
  } else {
    for (const st of rest) await createUser(db, orgId, { ...st, email: st.email ?? `${st.name.toLowerCase().replace(/[^a-z]+/g, ".")}@staff.rc.local`, password: cfg.password });
  }
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
  if (cfg.seedActivity) await seedDemoActivity(db, orgId);
  return { orgId, userId };
}

/** Makes a demo feel like week three of the season: a few players on the
 *  board, contacts and notes from different (demo) staff. All fictional. */
async function seedDemoActivity(db: Db, orgId: string) {
  const staff = await listUsers(db, orgId);
  const prospects = (await listApprovals(db, orgId, ["pending"])).filter((a) => a.kind === "prospect").slice(0, 4);
  const statuses = ["priority", "evaluating", "watching", "priority"];
  const script: Array<Array<{ kind: string; daysAgo: number; note?: string }>> = [
    [{ kind: "saw_play", daysAgo: 9, note: "Fall league — smooth actions at SS, plus arm" }, { kind: "call", daysAgo: 6, note: "Talked with dad, interested in our camp" }, { kind: "text", daysAgo: 2, note: "Sent camp details" }],
    [{ kind: "they_reached_out", daysAgo: 12, note: "Emailed us his video" }, { kind: "email", daysAgo: 11 }],
    [{ kind: "saw_play", daysAgo: 4, note: "Quick bat, needs work on first step" }],
    [{ kind: "text", daysAgo: 8 }, { kind: "campus_visit", daysAgo: 3, note: "Unofficial visit with parents" }],
  ];
  const notes = [
    "Top target at SS for '27. Wants to stay in North County. Follow up after his tournament.",
    "Good student per HS coach. Need updated 60 time.",
    "Watch him again in the spring before we push.",
    "Family loved campus. Ask about summer team schedule.",
  ];
  for (const [i, ap] of prospects.entries()) {
    if (!ap.athleteId) continue;
    const coach = staff[i % staff.length];
    const ctx: Ctx = { db, orgId, userId: coach.id, role: coach.role };
    await decideApproval({ ...ctx, role: "head_coach" }, ap.id, { decision: "approve" });
    await db.run("UPDATE follows SET board_status = ? WHERE org_id = ? AND athlete_id = ?", [statuses[i], orgId, ap.athleteId]);
    for (const [j, c] of script[i].entries()) {
      const who = staff[(i + j) % staff.length];
      await logContact({ db, orgId, userId: who.id, role: who.role }, ap.athleteId, { kind: c.kind, note: c.note ?? null, occurredAt: new Date(Date.now() - c.daysAgo * 86_400_000).toISOString() });
    }
    await addNote(ctx, ap.athleteId, notes[i]);
  }
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
