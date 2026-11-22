// Tenant-scoped data access. Every function takes an orgId (or a Ctx carrying
// one) and every query filters by it — this is the multi-tenant boundary.

import { Db, newId, nowIso, parseJson, Param, Row } from "../db";
import type { AthleteCore, MetricObservation, RecruitingCriteria, Role, SourceKind, Verification } from "../domain/types";
import { DEFAULT_COMPLIANCE, type ComplianceSettings } from "../domain/compliance";
import { DEFAULT_MINUTES_PER_TASK, type EventType } from "../domain/timesavings";
import { assertCan, type Action } from "../domain/permissions";
import { timezoneForLocation } from "../domain/time";

export interface Ctx {
  db: Db;
  orgId: string;
  userId: string | null; // null for background jobs
  role: Role | "system";
}

export function authorize(ctx: Ctx, action: Action) {
  if (ctx.role === "system") return;
  assertCan(ctx.role, action);
}

// ---------- orgs ----------

export interface OrgSettings {
  compliance: ComplianceSettings;
  minutesPerTask: Partial<Record<EventType, number>>;
  emailSendingEnabled: boolean;
  programDisplayName?: string;
  branding: Branding;
  /** Automatic stat updates from public pages coaches link to players. */
  pageWatch: { enabled: boolean; everyHours: number };
  /** IANA time zone for showing and reading game times (from campus unless set). */
  timezone: string;
  /** AI research agent that keeps the board current. */
  agent: { enabled: boolean; everyDays: number; maxPerDay: number; boardRequestedAt: string | null };
  /** Paid add-ons. Only RC's owners change this (from /admin), never a school's own settings. */
  plan: { aiResearch: boolean; aiMonthlyLimit: number; requestedAt: string | null; enabledAt: string | null };
}

export interface Branding {
  /** e.g. "Palomar Baseball" — shown in the header. */
  teamName: string | null;
  primary: string; // main team color (buttons, accents)
  ink: string; // header / dark surfaces
  accent: string; // secondary team color
  /** Logo as a data: URL (PNG, JPEG, WebP or SVG shown via <img>, so scripts never run). */
  logoDataUrl: string | null;
}

export const DEFAULT_BRANDING: Branding = { teamName: null, primary: "#1f3a68", ink: "#0f1722", accent: "#b8925a", logoDataUrl: null };

const HEX = /^#[0-9a-f]{6}$/i;
export function sanitizeBranding(b: Partial<Branding> | undefined): Branding {
  const x = { ...DEFAULT_BRANDING, ...(b ?? {}) };
  return {
    teamName: x.teamName ? String(x.teamName).slice(0, 60) : null,
    primary: HEX.test(x.primary) ? x.primary : DEFAULT_BRANDING.primary,
    ink: HEX.test(x.ink) ? x.ink : DEFAULT_BRANDING.ink,
    accent: HEX.test(x.accent) ? x.accent : DEFAULT_BRANDING.accent,
    logoDataUrl: x.logoDataUrl && /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(x.logoDataUrl) && x.logoDataUrl.length < 700_000 ? x.logoDataUrl : null,
  };
}

export interface Org {
  id: string;
  name: string;
  sport: string;
  campus: { label: string; lat: number; lng: number } | null;
  isDemo: boolean;
  settings: OrgSettings;
}

export function orgFromRow(r: Row): Org {
  const s = parseJson<Partial<OrgSettings>>(r.settings_json, {});
  return {
    id: String(r.id),
    name: String(r.name),
    sport: String(r.sport),
    campus:
      r.campus_lat != null && r.campus_lng != null
        ? { label: String(r.campus_label ?? "Campus"), lat: Number(r.campus_lat), lng: Number(r.campus_lng) }
        : null,
    isDemo: Boolean(Number(r.is_demo)),
    settings: {
      compliance: { ...DEFAULT_COMPLIANCE, ...(s.compliance ?? {}) },
      minutesPerTask: { ...DEFAULT_MINUTES_PER_TASK, ...(s.minutesPerTask ?? {}) },
      emailSendingEnabled: Boolean(s.emailSendingEnabled),
      programDisplayName: s.programDisplayName,
      branding: sanitizeBranding(s.branding),
      timezone: typeof s.timezone === "string" && s.timezone ? s.timezone : timezoneForLocation(r.campus_lat == null ? null : Number(r.campus_lat), r.campus_lng == null ? null : Number(r.campus_lng)),
      agent: {
        enabled: s.agent?.enabled ?? true,
        everyDays: Math.min(30, Math.max(1, Number(s.agent?.everyDays ?? 7))),
        maxPerDay: Math.min(500, Math.max(1, Number(s.agent?.maxPerDay ?? 25))),
        boardRequestedAt: s.agent?.boardRequestedAt ?? null,
      },
      plan: {
        aiResearch: Boolean(s.plan?.aiResearch),
        aiMonthlyLimit: Math.max(0, Number(s.plan?.aiMonthlyLimit ?? 400)),
        requestedAt: s.plan?.requestedAt ?? null,
        enabledAt: s.plan?.enabledAt ?? null,
      },
      pageWatch: { enabled: s.pageWatch?.enabled ?? true, everyHours: Math.min(168, Math.max(6, Number(s.pageWatch?.everyHours ?? 12))) },
    },
  };
}

export async function getOrg(db: Db, orgId: string): Promise<Org> {
  const r = await db.get("SELECT * FROM orgs WHERE id = ?", [orgId]);
  if (!r) throw new Error("Program not found");
  return orgFromRow(r);
}

export async function updateOrgSettings(ctx: Ctx, patch: Partial<OrgSettings>) {
  authorize(ctx, "manage_settings");
  if ("plan" in patch && ctx.role !== "system") throw new Error("Plan changes are made by RC, not from program settings.");
  const org = await getOrg(ctx.db, ctx.orgId);
  const next = { ...org.settings, ...patch };
  await ctx.db.run("UPDATE orgs SET settings_json = ? WHERE id = ?", [JSON.stringify(next), ctx.orgId]);
  await audit(ctx, "update_settings", "org", ctx.orgId, { keys: Object.keys(patch) });
}

export async function updateCampus(ctx: Ctx, campus: { label: string; lat: number; lng: number }, name?: string) {
  authorize(ctx, "manage_settings");
  await ctx.db.run("UPDATE orgs SET campus_label = ?, campus_lat = ?, campus_lng = ?, name = COALESCE(?, name) WHERE id = ?", [
    campus.label, campus.lat, campus.lng, name ?? null, ctx.orgId,
  ]);
  await audit(ctx, "update_campus", "org", ctx.orgId, campus);
}

// ---------- audit + events ----------

export async function audit(ctx: Ctx, action: string, entity: string, entityId: string | null, detail: unknown = {}) {
  await ctx.db.run(
    "INSERT INTO audit_log (id, org_id, user_id, action, entity, entity_id, detail_json, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [newId(), ctx.orgId, ctx.userId, action, entity, entityId, JSON.stringify(detail ?? {}), nowIso()],
  );
}

export interface EventInput {
  type: EventType;
  message: string;
  athleteId?: string | null;
  sourceId?: string | null;
  runId?: string | null;
  detail?: unknown;
}

export async function logEvent(db: Db, orgId: string, e: EventInput) {
  await db.run(
    "INSERT INTO events (id, org_id, run_id, type, athlete_id, source_id, message, detail_json, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [newId(), orgId, e.runId ?? null, e.type, e.athleteId ?? null, e.sourceId ?? null, e.message, JSON.stringify(e.detail ?? {}), nowIso()],
  );
}

export interface EventRow {
  id: string;
  type: EventType;
  message: string;
  athlete_id: string | null;
  source_id: string | null;
  run_id: string | null;
  detail_json: string;
  created_at: string;
}

export async function listEvents(db: Db, orgId: string, sinceIso: string, limit = 500): Promise<EventRow[]> {
  return db.all<EventRow>("SELECT * FROM events WHERE org_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT ?", [orgId, sinceIso, limit]);
}

export async function countEventsByType(db: Db, orgId: string, sinceIso: string): Promise<Partial<Record<EventType, number>>> {
  const rows = await db.all<{ type: EventType; n: number }>(
    "SELECT type, COUNT(*) AS n FROM events WHERE org_id = ? AND created_at > ? GROUP BY type",
    [orgId, sinceIso],
  );
  return Object.fromEntries(rows.map((r) => [r.type, Number(r.n)]));
}

// ---------- sources ----------

export interface Source {
  id: string;
  providerId: string;
  name: string;
  kind: SourceKind;
  status: string;
  statusDetail: string | null;
  attestedBy: string | null;
  lastCheckedAt: string | null;
  config: Record<string, unknown>;
  createdAt: string;
}

function sourceFromRow(r: Row): Source {
  return {
    id: String(r.id),
    providerId: String(r.provider_id),
    name: String(r.name),
    kind: r.kind as SourceKind,
    status: String(r.status),
    statusDetail: (r.status_detail as string) ?? null,
    attestedBy: (r.attested_by as string) ?? null,
    lastCheckedAt: (r.last_checked_at as string) ?? null,
    config: parseJson(r.config_json, {}),
    createdAt: String(r.created_at),
  };
}

export async function listSources(db: Db, orgId: string): Promise<Source[]> {
  return (await db.all("SELECT * FROM sources WHERE org_id = ? ORDER BY created_at", [orgId])).map(sourceFromRow);
}

export async function getSource(db: Db, orgId: string, id: string): Promise<Source | null> {
  const r = await db.get("SELECT * FROM sources WHERE org_id = ? AND id = ?", [orgId, id]);
  return r ? sourceFromRow(r) : null;
}

export async function createSource(
  db: Db,
  orgId: string,
  s: { providerId: string; name: string; kind: SourceKind; status: string; statusDetail?: string; attestedBy?: string | null; config?: object },
): Promise<Source> {
  const id = newId();
  await db.run(
    "INSERT INTO sources (id, org_id, provider_id, name, kind, status, status_detail, attested_by, config_json, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [id, orgId, s.providerId, s.name, s.kind, s.status, s.statusDetail ?? null, s.attestedBy ?? null, JSON.stringify(s.config ?? {}), nowIso()],
  );
  return (await getSource(db, orgId, id))!;
}

export async function updateSourceStatus(db: Db, orgId: string, id: string, status: string, detail: string | null, config?: object) {
  await db.run(
    `UPDATE sources SET status = ?, status_detail = ?, last_checked_at = ?${config ? ", config_json = ?" : ""} WHERE org_id = ? AND id = ?`,
    config ? [status, detail, nowIso(), JSON.stringify(config), orgId, id] : [status, detail, nowIso(), orgId, id],
  );
}

// ---------- athletes ----------

export interface AthleteRecord extends AthleteCore {
  bats: string | null;
  throws: string | null;
  geoPrecision: string | null;
  identityConfidence: number;
  email: string | null;
  guardianEmail: string | null;
  phone: string | null;
  xHandle: string | null;
  contactConsent: "granted" | "denied" | "unknown";
  isMinor: boolean | null;
  optedOut: boolean;
  createdAt: string;
  updatedAt: string;
}

export function athleteFromRow(r: Row): AthleteRecord {
  return {
    id: String(r.id),
    firstName: String(r.first_name),
    lastName: String(r.last_name),
    gradYear: r.grad_year == null ? null : Number(r.grad_year),
    sport: String(r.sport),
    primaryPosition: (r.primary_position as string) ?? null,
    secondaryPosition: (r.secondary_position as string) ?? null,
    bats: (r.bats as string) ?? null,
    throws: (r.throws as string) ?? null,
    highSchool: (r.high_school as string) ?? null,
    team: (r.team as string) ?? null,
    city: (r.city as string) ?? null,
    state: (r.state as string) ?? null,
    zip: (r.zip as string) ?? null,
    lat: r.lat == null ? null : Number(r.lat),
    lng: r.lng == null ? null : Number(r.lng),
    geoPrecision: (r.geo_precision as string) ?? null,
    identityConfidence: Number(r.identity_confidence ?? 1),
    commitmentStatus: (r.commitment_status as AthleteCore["commitmentStatus"]) ?? "unknown",
    commitmentVerified: Boolean(Number(r.commitment_verified)),
    email: (r.email as string) ?? null,
    guardianEmail: (r.guardian_email as string) ?? null,
    phone: (r.phone as string) ?? null,
    xHandle: (r.x_handle as string) ?? null,
    contactConsent: (r.contact_consent as AthleteRecord["contactConsent"]) ?? "unknown",
    isMinor: r.is_minor == null ? null : Boolean(Number(r.is_minor)),
    optedOut: Boolean(Number(r.opted_out)),
    isDemo: Boolean(Number(r.is_demo)),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export async function getAthlete(db: Db, orgId: string, id: string): Promise<AthleteRecord | null> {
  const r = await db.get("SELECT * FROM athletes WHERE org_id = ? AND id = ?", [orgId, id]);
  return r ? athleteFromRow(r) : null;
}

export async function listAthletes(db: Db, orgId: string, opts: { gradYears?: number[]; ids?: string[] } = {}): Promise<AthleteRecord[]> {
  const where = ["org_id = ?"];
  const params: Param[] = [orgId];
  if (opts.gradYears?.length) {
    where.push(`grad_year IN (${opts.gradYears.map(() => "?").join(",")})`);
    params.push(...opts.gradYears);
  }
  if (opts.ids) {
    if (opts.ids.length === 0) return [];
    where.push(`id IN (${opts.ids.map(() => "?").join(",")})`);
    params.push(...opts.ids);
  }
  return (await db.all(`SELECT * FROM athletes WHERE ${where.join(" AND ")} ORDER BY last_name, first_name`, params)).map(athleteFromRow);
}

export function obsFromRow(r: Row): MetricObservation & { eventName: string | null } {
  return {
    id: String(r.id),
    athleteId: String(r.athlete_id),
    sourceId: String(r.source_id),
    sourceName: String(r.source_name ?? "Unknown source"),
    sourceKind: (r.source_kind as SourceKind) ?? "import",
    metricKey: String(r.metric_key),
    value: Number(r.value),
    unit: String(r.unit),
    measuredAt: (r.measured_at as string) ?? null,
    checkedAt: String(r.checked_at),
    verification: r.verification as Verification,
    sourceUrl: (r.source_url as string) ?? null,
    eventName: (r.event_name as string) ?? null,
  };
}

export async function listObservations(db: Db, orgId: string, athleteIds?: string[]) {
  const base = `SELECT o.*, s.name AS source_name, s.kind AS source_kind FROM metric_observations o JOIN sources s ON s.id = o.source_id WHERE o.org_id = ?`;
  if (athleteIds && athleteIds.length === 0) return [];
  const rows = athleteIds
    ? await db.all(`${base} AND o.athlete_id IN (${athleteIds.map(() => "?").join(",")})`, [orgId, ...athleteIds])
    : await db.all(base, [orgId]);
  return rows.map(obsFromRow);
}

export async function updateAthleteContact(
  ctx: Ctx,
  athleteId: string,
  patch: { email?: string | null; guardianEmail?: string | null; phone?: string | null; xHandle?: string | null; contactConsent?: string; isMinor?: boolean | null; optedOut?: boolean },
) {
  authorize(ctx, "note");
  const a = await getAthlete(ctx.db, ctx.orgId, athleteId);
  if (!a) throw new Error("Athlete not found");
  await ctx.db.run(
    "UPDATE athletes SET email = ?, guardian_email = ?, phone = ?, x_handle = ?, contact_consent = ?, is_minor = ?, opted_out = ?, updated_at = ? WHERE org_id = ? AND id = ?",
    [
      patch.email !== undefined ? patch.email : a.email,
      patch.guardianEmail !== undefined ? patch.guardianEmail : a.guardianEmail,
      patch.phone !== undefined ? normalizePhone(patch.phone) : a.phone,
      patch.xHandle !== undefined ? normalizeXHandle(patch.xHandle) : a.xHandle,
      patch.contactConsent ?? a.contactConsent,
      patch.isMinor !== undefined ? (patch.isMinor == null ? null : patch.isMinor ? 1 : 0) : a.isMinor == null ? null : a.isMinor ? 1 : 0,
      patch.optedOut !== undefined ? (patch.optedOut ? 1 : 0) : a.optedOut ? 1 : 0,
      nowIso(),
      ctx.orgId,
      athleteId,
    ],
  );
  await audit(ctx, "update_contact", "athlete", athleteId, { fields: Object.keys(patch) });
}

// ---------- follows / board ----------

export async function isFollowing(db: Db, orgId: string, athleteId: string) {
  return Boolean(await db.get("SELECT id FROM follows WHERE org_id = ? AND athlete_id = ?", [orgId, athleteId]));
}

export async function followedIds(db: Db, orgId: string): Promise<Set<string>> {
  return new Set((await db.all<{ athlete_id: string }>("SELECT athlete_id FROM follows WHERE org_id = ?", [orgId])).map((r) => r.athlete_id));
}

export async function setFollow(ctx: Ctx, athleteId: string, follow: boolean, boardStatus = "watching") {
  authorize(ctx, "follow");
  const a = await getAthlete(ctx.db, ctx.orgId, athleteId);
  if (!a) throw new Error("Athlete not found");
  if (follow) {
    await ctx.db.run(
      "INSERT INTO follows (id, org_id, athlete_id, user_id, board_status, created_at) VALUES (?,?,?,?,?,?) ON CONFLICT (org_id, athlete_id) DO UPDATE SET board_status = excluded.board_status",
      [newId(), ctx.orgId, athleteId, ctx.userId ?? "system", boardStatus, nowIso()],
    );
  } else {
    await ctx.db.run("DELETE FROM follows WHERE org_id = ? AND athlete_id = ?", [ctx.orgId, athleteId]);
  }
  await audit(ctx, follow ? "follow" : "unfollow", "athlete", athleteId, { boardStatus });
  if (ctx.userId) await logEvent(ctx.db, ctx.orgId, { type: "coach_action", message: `${follow ? "Followed" : "Unfollowed"} ${a.firstName} ${a.lastName}`, athleteId });
}

export async function listFollows(db: Db, orgId: string) {
  return db.all<{ athlete_id: string; board_status: string; created_at: string }>(
    "SELECT athlete_id, board_status, created_at FROM follows WHERE org_id = ? ORDER BY created_at DESC",
    [orgId],
  );
}

// ---------- notes / tasks ----------

export async function addNote(ctx: Ctx, athleteId: string, body: string) {
  authorize(ctx, "note");
  if (!(await getAthlete(ctx.db, ctx.orgId, athleteId))) throw new Error("Athlete not found");
  const id = newId();
  await ctx.db.run("INSERT INTO notes (id, org_id, athlete_id, user_id, body, created_at) VALUES (?,?,?,?,?,?)", [
    id, ctx.orgId, athleteId, ctx.userId ?? "system", body, nowIso(),
  ]);
  await audit(ctx, "add_note", "athlete", athleteId);
}

export async function listNotes(db: Db, orgId: string, athleteId: string) {
  return db.all<{ id: string; body: string; created_at: string; user_name: string | null }>(
    "SELECT n.id, n.body, n.created_at, u.name AS user_name FROM notes n LEFT JOIN users u ON u.id = n.user_id WHERE n.org_id = ? AND n.athlete_id = ? ORDER BY n.created_at DESC",
    [orgId, athleteId],
  );
}

export async function createTask(
  db: Db,
  orgId: string,
  t: { title: string; athleteId?: string | null; dueAt?: string | null; origin: "mission" | "coach"; createdBy?: string | null; runId?: string | null },
): Promise<boolean> {
  // De-duplicate identical open tasks (missions re-run often).
  const existing = await db.get("SELECT id FROM tasks WHERE org_id = ? AND title = ? AND status = 'open'", [orgId, t.title]);
  if (existing) return false;
  await db.run(
    "INSERT INTO tasks (id, org_id, athlete_id, title, due_at, status, origin, created_by, created_at) VALUES (?,?,?,?,?,'open',?,?,?)",
    [newId(), orgId, t.athleteId ?? null, t.title, t.dueAt ?? null, t.origin, t.createdBy ?? null, nowIso()],
  );
  await logEvent(db, orgId, { type: "task_created", message: `Task: ${t.title}`, athleteId: t.athleteId, runId: t.runId });
  return true;
}

export async function listTasks(db: Db, orgId: string, status = "open") {
  return db.all<{ id: string; title: string; due_at: string | null; athlete_id: string | null; origin: string; created_at: string }>(
    "SELECT * FROM tasks WHERE org_id = ? AND status = ? ORDER BY COALESCE(due_at, created_at) ASC LIMIT 100",
    [orgId, status],
  );
}

export async function completeTask(ctx: Ctx, taskId: string) {
  authorize(ctx, "note");
  const r = await ctx.db.run("UPDATE tasks SET status = 'done', completed_at = ? WHERE org_id = ? AND id = ?", [nowIso(), ctx.orgId, taskId]);
  if (r.changes === 0) throw new Error("Task not found");
  await audit(ctx, "complete_task", "task", taskId);
  await logEvent(ctx.db, ctx.orgId, { type: "coach_action", message: "Completed a recruiting task" });
}

// ---------- profiles & missions ----------

export interface Profile {
  id: string;
  name: string;
  criteria: RecruitingCriteria;
  createdAt: string;
  updatedAt: string;
}

export async function listProfiles(db: Db, orgId: string): Promise<Profile[]> {
  return (await db.all("SELECT * FROM recruiting_profiles WHERE org_id = ? ORDER BY updated_at DESC", [orgId])).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    criteria: parseJson(r.criteria_json, {} as RecruitingCriteria),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));
}

export async function getProfile(db: Db, orgId: string, id: string): Promise<Profile | null> {
  return (await listProfiles(db, orgId)).find((p) => p.id === id) ?? null;
}

export const PLAN_LIMITS = { profiles: 50, missions: 25 };

export async function saveProfile(ctx: Ctx, name: string, criteria: RecruitingCriteria, id?: string): Promise<string> {
  authorize(ctx, "manage_profiles");
  const now = nowIso();
  if (id) {
    const r = await ctx.db.run("UPDATE recruiting_profiles SET name = ?, criteria_json = ?, updated_at = ? WHERE org_id = ? AND id = ?", [
      name, JSON.stringify(criteria), now, ctx.orgId, id,
    ]);
    if (r.changes === 0) throw new Error("Profile not found");
    await audit(ctx, "update_profile", "recruiting_profile", id);
    return id;
  }
  const count = await ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM recruiting_profiles WHERE org_id = ?", [ctx.orgId]);
  if (Number(count?.n ?? 0) >= PLAN_LIMITS.profiles) throw new Error(`Your plan allows ${PLAN_LIMITS.profiles} saved recruiting profiles.`);
  const newIdv = newId();
  await ctx.db.run(
    "INSERT INTO recruiting_profiles (id, org_id, name, criteria_json, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
    [newIdv, ctx.orgId, name, JSON.stringify(criteria), ctx.userId ?? "system", now, now],
  );
  await audit(ctx, "create_profile", "recruiting_profile", newIdv, { name });
  return newIdv;
}

export async function deleteProfile(ctx: Ctx, id: string) {
  authorize(ctx, "manage_profiles");
  const inUse = await ctx.db.get("SELECT id FROM missions WHERE org_id = ? AND profile_id = ?", [ctx.orgId, id]);
  if (inUse) throw new Error("This profile is used by a mission. Delete the mission first.");
  await ctx.db.run("DELETE FROM recruiting_profiles WHERE org_id = ? AND id = ?", [ctx.orgId, id]);
  await audit(ctx, "delete_profile", "recruiting_profile", id);
}

export interface MissionActions {
  discover: boolean;
  monitorGames: boolean;
  prepareCampInvites: boolean;
  campId: string | null;
}

export interface Mission {
  id: string;
  profileId: string;
  name: string;
  schedule: "daily" | "weekly" | "manual";
  actions: MissionActions;
  active: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
}

function missionFromRow(r: Row): Mission {
  return {
    id: String(r.id),
    profileId: String(r.profile_id),
    name: String(r.name),
    schedule: r.schedule as Mission["schedule"],
    actions: { discover: true, monitorGames: false, prepareCampInvites: false, campId: null, ...parseJson<Partial<MissionActions>>(r.actions_json, {}) },
    active: Boolean(Number(r.active)),
    nextRunAt: (r.next_run_at as string) ?? null,
    lastRunAt: (r.last_run_at as string) ?? null,
    createdAt: String(r.created_at),
  };
}

export async function listMissions(db: Db, orgId: string): Promise<Mission[]> {
  return (await db.all("SELECT * FROM missions WHERE org_id = ? ORDER BY created_at DESC", [orgId])).map(missionFromRow);
}

export async function getMission(db: Db, orgId: string, id: string): Promise<Mission | null> {
  const r = await db.get("SELECT * FROM missions WHERE org_id = ? AND id = ?", [orgId, id]);
  return r ? missionFromRow(r) : null;
}

export function nextRunAfter(schedule: Mission["schedule"], from = new Date()): string | null {
  if (schedule === "manual") return null;
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + (schedule === "daily" ? 1 : 7));
  return d.toISOString();
}

export async function createMission(
  ctx: Ctx,
  m: { profileId: string; name: string; schedule: Mission["schedule"]; actions: MissionActions },
): Promise<string> {
  authorize(ctx, "manage_profiles");
  if (!(await getProfile(ctx.db, ctx.orgId, m.profileId))) throw new Error("Profile not found");
  const count = await ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM missions WHERE org_id = ?", [ctx.orgId]);
  if (Number(count?.n ?? 0) >= PLAN_LIMITS.missions) throw new Error(`Your plan allows ${PLAN_LIMITS.missions} recurring missions.`);
  const id = newId();
  // New missions are due immediately so the first run happens on the next worker tick.
  await ctx.db.run(
    "INSERT INTO missions (id, org_id, profile_id, name, schedule, actions_json, active, next_run_at, created_by, created_at) VALUES (?,?,?,?,?,?,1,?,?,?)",
    [id, ctx.orgId, m.profileId, m.name, m.schedule, JSON.stringify(m.actions), m.schedule === "manual" ? null : nowIso(), ctx.userId ?? "system", nowIso()],
  );
  await audit(ctx, "create_mission", "mission", id, m);
  return id;
}

export async function setMissionActive(ctx: Ctx, id: string, active: boolean) {
  authorize(ctx, "manage_profiles");
  const m = await getMission(ctx.db, ctx.orgId, id);
  if (!m) throw new Error("Mission not found");
  await ctx.db.run("UPDATE missions SET active = ?, next_run_at = ? WHERE org_id = ? AND id = ?", [
    active ? 1 : 0, active && m.schedule !== "manual" ? nowIso() : null, ctx.orgId, id,
  ]);
  await audit(ctx, active ? "resume_mission" : "pause_mission", "mission", id);
}

export async function deleteMission(ctx: Ctx, id: string) {
  authorize(ctx, "manage_profiles");
  await ctx.db.tx(async (db) => {
    await db.run("DELETE FROM mission_matches WHERE org_id = ? AND mission_id = ?", [ctx.orgId, id]);
    await db.run("DELETE FROM missions WHERE org_id = ? AND id = ?", [ctx.orgId, id]);
  });
  await audit(ctx, "delete_mission", "mission", id);
}

// ---------- job runs ----------

export async function listJobRuns(db: Db, orgId: string, limit = 20) {
  return db.all<{ id: string; mission_id: string | null; kind: string; status: string; trigger: string; started_at: string; finished_at: string | null; error: string | null; stats_json: string; mission_name: string | null }>(
    "SELECT j.*, m.name AS mission_name FROM job_runs j LEFT JOIN missions m ON m.id = j.mission_id WHERE j.org_id = ? ORDER BY j.started_at DESC LIMIT ?",
    [orgId, limit],
  );
}

// ---------- users ----------

export interface User {
  id: string;
  orgId: string;
  email: string;
  name: string;
  title: string | null;
  role: Role;
  lastBriefAt: string | null;
  /** The program's shared staff login (not a person). */
  isShared: boolean;
}

export function userFromRow(r: Row): User {
  return {
    id: String(r.id),
    orgId: String(r.org_id),
    email: String(r.email),
    name: String(r.name),
    title: (r.title as string) ?? null,
    role: r.role as Role,
    lastBriefAt: (r.last_brief_at as string) ?? null,
    isShared: Boolean(Number(r.is_shared ?? 0)),
  };
}

export async function listUsers(db: Db, orgId: string): Promise<User[]> {
  return (await db.all("SELECT * FROM users WHERE org_id = ? AND is_shared = 0 ORDER BY created_at", [orgId])).map(userFromRow);
}

export async function markBriefReviewed(ctx: Ctx) {
  if (!ctx.userId) return;
  await ctx.db.run("UPDATE users SET last_brief_at = ? WHERE id = ? AND org_id = ?", [nowIso(), ctx.userId, ctx.orgId]);
}

export async function listAudit(ctx: Ctx, limit = 100) {
  authorize(ctx, "view_audit");
  return ctx.db.all<{ id: string; action: string; entity: string; entity_id: string | null; detail_json: string; created_at: string; user_name: string | null }>(
    "SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.org_id = ? ORDER BY a.created_at DESC LIMIT ?",
    [ctx.orgId, limit],
  );
}

/** "(760) 555-0101", "760.555.0101", "+1 760 555 0101" → "(760) 555-0101". Returns null if not a US number. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (d.length !== 10 || /^[01]/.test(d)) return null;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** "@jpike27", "x.com/jpike27", "https://twitter.com/jpike27" → "jpike27". */
export function normalizeXHandle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/@?([A-Za-z0-9_]{1,15})|^@?([A-Za-z0-9_]{1,15})$/);
  return m ? (m[1] ?? m[2]) : null;
}
