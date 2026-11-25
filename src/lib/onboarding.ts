import { randomBytes } from "node:crypto";
// Creating programs. A real program starts EMPTY: no athletes until the coach
// imports authorized data or connects a licensed provider. A demo workspace
// is clearly flagged and is the only place fictional fixtures ever load.

import { Db, newId, nowIso } from "./db";
import { addStaffProfile, createUser, setSharedLogin } from "./auth";
import { geocode, zipFor } from "./domain/geo";
import { defaultCriteria } from "./domain/criteria";
import { PROVIDERS } from "./providers/registry";
import { addNote, createMission, createSource, listUsers, saveProfile, sanitizeBranding, updateOrgSettings, type Branding, type Ctx } from "./repo";
import { createApproval, decideApproval, listApprovals } from "./repo/approvals";
import { logContact } from "./repo/contacts";
import type { Role } from "./domain/types";
import { createCamp } from "./repo/approvals";
import { runMission } from "./jobs/runner";
import { buildFast } from "./demo/fast-build";
import { deriveTheme, normalizeHex } from "./theme";

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
  // Two players get demo "pages found" so the approve/dismiss flow can be tried.
  // Placeholder example.com links only — never real people's pages.
  const followed = await db.all<{ athlete_id: string }>("SELECT athlete_id FROM follows WHERE org_id = ? LIMIT 2", [orgId]);
  for (const { athlete_id } of followed) {
    const a = await db.get<{ first_name: string; last_name: string; high_school: string | null; grad_year: number | null }>("SELECT first_name, last_name, high_school, grad_year FROM athletes WHERE id = ?", [athlete_id]);
    if (!a) continue;
    const slug = `${a.first_name}-${a.last_name}`.toLowerCase();
    const found = [
      { site: "MaxPreps (demo)", kind: "stats", url: `https://example.com/demo/maxpreps/${slug}`, title: `${a.first_name} ${a.last_name} — ${a.high_school ?? ""} Baseball Stats (demo)` },
      { site: "X (demo)", kind: "social", url: `https://example.com/demo/x/${slug}`, title: `${a.first_name} ${a.last_name} (@${a.first_name.toLowerCase()}_${a.last_name.toLowerCase()}) (demo)` },
      { site: "Hudl (demo)", kind: "film", url: `https://example.com/demo/hudl/${slug}`, title: `${a.first_name} ${a.last_name} highlights (demo)` },
    ];
    const ids: string[] = [];
    for (const f of found) {
      const id = newId();
      ids.push(id);
      await db.run("INSERT INTO link_candidates (id, org_id, athlete_id, url, kind, site, title, snippet, score, reasons, status, found_at) VALUES (?,?,?,?,?,?,?,?,?,?,'pending',?)", [
        id, orgId, athlete_id, f.url, f.kind, f.site, f.title, "Demo search result", 0.9, `First and last name, ${a.grad_year ? `Class of ${a.grad_year}, ` : ""}school (demo)`, nowIso(),
      ]);
    }
    await createApproval(db, orgId, { kind: "links_found", title: `3 pages found for ${a.first_name} ${a.last_name}`, summary: "RC searched the public web and found MaxPreps, X and Hudl (demo placeholders). Keep the ones that are really him; approved stat pages update automatically.", payload: { candidateIds: ids }, athleteId: athlete_id });
  }
}

export const GUEST_EMAIL_DOMAIN = "guest.rc.local";
export const GUEST_DEMOS_PER_HOUR = () => Math.max(0, Number(process.env.RC_GUEST_DEMOS_PER_HOUR ?? 60));

/** "Try RC now": a private, throwaway demo with sample players. No sign-up. */
export interface DemoLook { programName?: string; teamName?: string | null; campusZip?: string; branding?: Partial<Branding> }

export async function createGuestDemo(db: Db, look: DemoLook = {}): Promise<{ orgId: string; userId: string }> {
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const recent = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE email LIKE ? AND role = 'head_coach' AND created_at >= ?", [`%@${GUEST_EMAIL_DOMAIN}`, since]);
  if (Number(recent?.n ?? 0) >= GUEST_DEMOS_PER_HOUR()) throw new Error("Lots of people are trying RC right now. Try again in a few minutes.");
  const tag = randomBytes(6).toString("hex");
  const { mode: _mode, ...ids } = await buildFast(db, (target) => createDemoProgram(target, {
    programName: look.programName ? `${look.programName} (DEMO — fictional players)` : "Demo State University (DEMO — fictional data)",
    teamName: look.teamName ?? (look.programName ? null : "Demo State Baseball") ?? undefined,
    campusZip: look.campusZip ?? "78712",
    branding: look.branding,
    staff: [
      { name: "Coach (you)", title: "Head Baseball Coach (demo)", role: "head_coach", email: `guest-${tag}@${GUEST_EMAIL_DOMAIN}` },
      { name: "Assistant Coach", title: "Recruiting Coordinator (demo)", role: "assistant_coach", email: `guest-${tag}-staff@${GUEST_EMAIL_DOMAIN}` },
    ],
    password: randomBytes(24).toString("base64url"), // never shown; the guest is signed in directly
    seedActivity: true,
  }));
  void _mode;
  return ids;
}

export interface SchoolDemoInput {
  school: string;
  teamName?: string | null;
  campus?: string | null; // ZIP or "City, ST"
  primary?: string | null;
  accent?: string | null;
  logoDataUrl?: string | null;
}

export const DEFAULT_DEMO_CAMPUS = "78712";

/** Checks a coach's "See RC for your program" form and turns it into a demo look. Throws a coach-readable message. */
export function schoolDemoLook(input: SchoolDemoInput): DemoLook {
  const school = String(input.school ?? "").replace(/\s+/g, " ").trim();
  if (school.length < 2) throw new Error("Enter your school or program name.");
  if (school.length > 60) throw new Error("Keep the school name under 60 characters.");
  const campusRaw = String(input.campus ?? "").trim();
  let campusZip = DEFAULT_DEMO_CAMPUS;
  if (campusRaw) {
    const z = zipFor(campusRaw);
    if (!z) throw new Error(`We couldn't find "${campusRaw}". Use your campus ZIP code or "City, ST".`);
    campusZip = z;
  }
  const primary = normalizeHex(input.primary) ?? "#1f3a68";
  const accent = normalizeHex(input.accent) ?? "#b8925a";
  const t = deriveTheme({ primary, accent });
  const teamName = (input.teamName ?? "").trim().slice(0, 40) || (/\b(baseball)\b/i.test(school) ? school : `${school} Baseball`);
  const branding = sanitizeBranding({ teamName, primary: t.primary, accent: t.accent, ink: t.ink, logoDataUrl: input.logoDataUrl ?? null });
  return { programName: school, teamName, campusZip, branding };
}

/** "See RC for your program": a private demo in the school's colors (and logo, if uploaded). */
export async function createSchoolDemo(db: Db, input: SchoolDemoInput): Promise<{ orgId: string; userId: string }> {
  return createGuestDemo(db, schoolDemoLook(input));
}

/** Generic demo used by the sign-up page. */
export async function createDemoWorkspace(db: Db, email: string, password: string, coachName = "Demo Coach") {
  if (await db.get("SELECT id FROM users WHERE LOWER(email) = ?", [email.trim().toLowerCase()])) throw new Error("An account with that email already exists.");
  const { orgId, userId } = await buildFast(db, (target) => createDemoProgram(target, {
    programName: "Demo State University (DEMO — fictional data)",
    teamName: "Demo State Baseball",
    campusZip: "78712",
    staff: [{ name: coachName, title: "Head Baseball Coach (demo)", role: "head_coach", email }],
    password,
  }));
  return { orgId, userId };
}
