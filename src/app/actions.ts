"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { authenticate, createSession, createUser, destroySession } from "@/lib/auth";
import { SESSION_COOKIE, requireSession } from "@/lib/session";
import { createDemoWorkspace, createProgram } from "@/lib/onboarding";
import {
  addNote, completeTask, createMission, createSource, deleteMission, deleteProfile, markBriefReviewed, saveProfile,
  setFollow, setMissionActive, updateAthleteContact, updateCampus, updateOrgSettings, authorize, audit, logEvent, getMission,
  type MissionActions,
} from "@/lib/repo";
import {
  deleteAthleteData, createCamp, decideApproval, markMessageSentManually, prepareDraft, sendMessage, setCampTargetStatus, type Decision,
} from "@/lib/repo/approvals";
import { runMission, syncSources, describeIngest } from "@/lib/jobs/runner";
import { ingestRecords } from "@/lib/ingest";
import { parseAthleteCsv, parseScheduleCsv } from "@/lib/providers/csv";
import { criteriaFromForm, encodeCriteria, decodeCriteria } from "@/lib/criteria-form";
import { geocode } from "@/lib/domain/geo";
import type { MessageKind } from "@/lib/domain/compliance";
import type { Role } from "@/lib/domain/types";

async function startSession(userId: string) {
  const db = await getDb();
  const { token, expiresAt } = await createSession(db, userId);
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", expires: expiresAt, path: "/" });
}

function str(fd: FormData, k: string) {
  return String(fd.get(k) ?? "").trim();
}

function back(fd: FormData, fallback = "/") {
  const to = str(fd, "returnTo");
  return to.startsWith("/") && !to.startsWith("//") ? to : fallback;
}

function withFlash(path: string, msg: string, kind: "ok" | "err" = "ok") {
  const [base, query = ""] = path.split("?");
  const qs = new URLSearchParams(query);
  qs.set(kind === "ok" ? "flash" : "error", msg);
  return `${base}?${qs.toString()}`;
}

// ---------- auth ----------

export async function loginAction(fd: FormData) {
  const db = await getDb();
  let user;
  try {
    user = await authenticate(db, str(fd, "email"), str(fd, "password"));
  } catch (e) {
    redirect("/login?error=" + encodeURIComponent(e instanceof Error ? e.message : "Sign-in failed."));
  }
  if (!user) redirect("/login?error=" + encodeURIComponent("Email or password is incorrect."));
  await startSession(user.id);
  redirect("/");
}

export async function logoutAction() {
  const db = await getDb();
  const jar = await cookies();
  await destroySession(db, jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

export async function signupAction(fd: FormData) {
  const db = await getDb();
  let userId: string;
  try {
    if (str(fd, "mode") === "demo") {
      ({ userId } = await createDemoWorkspace(db, str(fd, "email"), str(fd, "password"), str(fd, "coachName") || "Demo Coach"));
    } else {
      ({ userId } = await createProgram(db, {
        programName: str(fd, "programName"),
        campusLocation: str(fd, "campus") || undefined,
        coachName: str(fd, "coachName"),
        coachTitle: str(fd, "coachTitle") || undefined,
        email: str(fd, "email"),
        password: str(fd, "password"),
      }));
    }
  } catch (e) {
    redirect("/signup?error=" + encodeURIComponent(e instanceof Error ? e.message : "Could not create account"));
  }
  await startSession(userId);
  redirect("/");
}

// ---------- home / brief ----------

export async function markBriefReviewedAction() {
  const { ctx } = await requireSession();
  await markBriefReviewed(ctx);
  revalidatePath("/");
}

export async function decideApprovalAction(fd: FormData) {
  const { ctx } = await requireSession();
  const to = back(fd);
  let msg: string;
  try {
    const subject = fd.has("subject") ? str(fd, "subject") : undefined;
    const body = fd.has("body") ? String(fd.get("body") ?? "") : undefined;
    const edits = subject !== undefined || body !== undefined ? { subject, body } : undefined;
    const r = await decideApproval(ctx, str(fd, "approvalId"), { decision: str(fd, "decision") as Decision, note: str(fd, "note") || undefined, edits });
    msg = r.result;
  } catch (e) {
    redirect(withFlash(to, e instanceof Error ? e.message : "Failed", "err"));
  }
  revalidatePath("/", "layout");
  redirect(withFlash(to, msg));
}

export async function completeTaskAction(fd: FormData) {
  const { ctx } = await requireSession();
  await completeTask(ctx, str(fd, "taskId"));
  revalidatePath("/", "layout");
}

// ---------- discover ----------

export async function buildCriteriaAction(fd: FormData) {
  const { org } = await requireSession();
  const { criteria, warnings } = criteriaFromForm(fd, org);
  const qs = new URLSearchParams({ c: encodeCriteria(criteria) });
  if (warnings.length) qs.set("error", warnings.join(" "));
  if (str(fd, "showAll")) qs.set("all", "1");
  redirect(`/discover?${qs.toString()}`);
}

export async function saveProfileAction(fd: FormData) {
  const { ctx } = await requireSession();
  const criteria = decodeCriteria(str(fd, "criteria"));
  if (!criteria) redirect("/discover?error=Invalid+criteria");
  let profileId: string;
  try {
    profileId = await saveProfile(ctx, str(fd, "name") || "Untitled recruiting profile", criteria);
    if (str(fd, "createMission")) {
      const actions: MissionActions = {
        discover: true,
        monitorGames: Boolean(str(fd, "monitorGames")),
        prepareCampInvites: Boolean(str(fd, "campId")),
        campId: str(fd, "campId") || null,
      };
      const missionId = await createMission(ctx, { profileId, name: str(fd, "name") || "Discovery mission", schedule: (str(fd, "schedule") || "daily") as "daily" | "weekly" | "manual", actions });
      if (str(fd, "runNow")) await runMission(ctx.db, ctx.orgId, missionId, "manual");
    }
  } catch (e) {
    redirect(withFlash(`/discover?c=${encodeURIComponent(str(fd, "criteria"))}`, e instanceof Error ? e.message : "Failed", "err"));
  }
  revalidatePath("/", "layout");
  redirect(withFlash("/missions", str(fd, "createMission") ? "Recurring mission saved. RC will keep working on it." : "Recruiting profile saved."));
}

export async function toggleFollowAction(fd: FormData) {
  const { ctx } = await requireSession();
  await setFollow(ctx, str(fd, "athleteId"), str(fd, "follow") === "1", str(fd, "boardStatus") || "watching");
  revalidatePath("/", "layout");
  redirect(back(fd, "/following"));
}

// ---------- missions ----------

export async function runMissionAction(fd: FormData) {
  const { ctx } = await requireSession();
  authorize(ctx, "run_missions");
  const m = await getMission(ctx.db, ctx.orgId, str(fd, "missionId"));
  if (!m) redirect(withFlash("/missions", "Mission not found", "err"));
  const r = await runMission(ctx.db, ctx.orgId, m.id, "manual");
  await audit(ctx, "run_mission", "mission", m.id, { runId: r.runId, status: r.status });
  revalidatePath("/", "layout");
  redirect(
    withFlash(
      back(fd, "/missions"),
      r.status === "succeeded"
        ? `Mission ran: ${r.stats!.athletesEvaluated} athletes evaluated, ${r.stats!.eligible} meet your standards, ${r.stats!.newMatches} new.`
        : `Mission failed: ${r.error}`,
      r.status === "succeeded" ? "ok" : "err",
    ),
  );
}

export async function toggleMissionAction(fd: FormData) {
  const { ctx } = await requireSession();
  await setMissionActive(ctx, str(fd, "missionId"), str(fd, "active") === "1");
  revalidatePath("/missions");
}

export async function deleteMissionAction(fd: FormData) {
  const { ctx } = await requireSession();
  await deleteMission(ctx, str(fd, "missionId"));
  revalidatePath("/missions");
}

export async function deleteProfileAction(fd: FormData) {
  const { ctx } = await requireSession();
  try {
    await deleteProfile(ctx, str(fd, "profileId"));
  } catch (e) {
    redirect(withFlash("/missions", e instanceof Error ? e.message : "Failed", "err"));
  }
  revalidatePath("/missions");
}

// ---------- athlete ----------

export async function addNoteAction(fd: FormData) {
  const { ctx } = await requireSession();
  const body = str(fd, "body");
  if (body) await addNote(ctx, str(fd, "athleteId"), body);
  revalidatePath(`/athletes/${str(fd, "athleteId")}`);
}

export async function updateContactAction(fd: FormData) {
  const { ctx } = await requireSession();
  const minor = str(fd, "isMinor");
  await updateAthleteContact(ctx, str(fd, "athleteId"), {
    email: str(fd, "email") || null,
    guardianEmail: str(fd, "guardianEmail") || null,
    contactConsent: str(fd, "contactConsent") || "unknown",
    isMinor: minor === "" ? null : minor === "1",
    optedOut: Boolean(str(fd, "optedOut")),
  });
  revalidatePath(`/athletes/${str(fd, "athleteId")}`);
  redirect(withFlash(`/athletes/${str(fd, "athleteId")}`, "Contact & consent details saved."));
}

export async function draftOutreachAction(fd: FormData) {
  const { ctx } = await requireSession();
  const athleteId = str(fd, "athleteId");
  try {
    await prepareDraft(ctx, { athleteId, kind: str(fd, "kind") as MessageKind, campId: str(fd, "campId") || null });
  } catch (e) {
    redirect(withFlash(`/athletes/${athleteId}`, e instanceof Error ? e.message : "Failed", "err"));
  }
  revalidatePath("/", "layout");
  redirect(withFlash(`/athletes/${athleteId}`, "Draft prepared. Review it in Needs Your Approval."));
}

export async function sendMessageAction(fd: FormData) {
  const { ctx } = await requireSession();
  const to = back(fd);
  let msg = "Sent";
  try {
    if (str(fd, "manual")) {
      await markMessageSentManually(ctx, str(fd, "messageId"));
      msg = "Marked as sent from your email client.";
    } else msg = await sendMessage(ctx, str(fd, "messageId"));
  } catch (e) {
    redirect(withFlash(to, e instanceof Error ? e.message : "Failed", "err"));
  }
  revalidatePath("/", "layout");
  redirect(withFlash(to, msg));
}

// ---------- camps ----------

export async function createCampAction(fd: FormData) {
  const { ctx } = await requireSession();
  const date = str(fd, "startsAt");
  if (!date || Number.isNaN(Date.parse(date))) redirect(withFlash("/camps", "Enter a valid camp date.", "err"));
  await createCamp(ctx, {
    name: str(fd, "name") || "Prospect camp",
    startsAt: new Date(date).toISOString(),
    location: str(fd, "location") || null,
    registrationUrl: str(fd, "registrationUrl") || null,
    profileId: str(fd, "profileId") || null,
  });
  revalidatePath("/camps");
  redirect(withFlash("/camps", "Camp created."));
}

export async function campTargetingAction(fd: FormData) {
  const { ctx } = await requireSession();
  const campId = str(fd, "campId");
  const profileId = str(fd, "profileId");
  if (!profileId) redirect(withFlash("/camps", "Choose a recruiting profile to target with.", "err"));
  try {
    const missionId = await createMission(ctx, {
      profileId,
      name: `Camp targeting: ${str(fd, "campName")}`,
      schedule: "weekly",
      actions: { discover: true, monitorGames: false, prepareCampInvites: true, campId },
    });
    const r = await runMission(ctx.db, ctx.orgId, missionId, "manual");
    if (r.status === "failed") throw new Error(r.error);
    revalidatePath("/", "layout");
    redirect(withFlash("/camps", r.stats!.campListSize ? `${r.stats!.campListSize} prospects targeted. Approve the invitation list on Home.` : "No new prospects matched this profile for the camp."));
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e;
    redirect(withFlash("/camps", e instanceof Error ? e.message : "Failed", "err"));
  }
}

export async function campTargetStatusAction(fd: FormData) {
  const { ctx } = await requireSession();
  await setCampTargetStatus(ctx, str(fd, "campId"), str(fd, "athleteId"), str(fd, "status") as "registered");
  revalidatePath("/camps");
}

// ---------- settings ----------

export async function updateProgramAction(fd: FormData) {
  const { ctx } = await requireSession();
  const loc = str(fd, "campus");
  const g = geocode(loc);
  if (!g) redirect(withFlash("/settings", `Couldn't find "${loc}". Use a ZIP code or "City, ST".`, "err"));
  await updateCampus(ctx, { label: `Campus (${g.label})`, lat: g.lat, lng: g.lng }, str(fd, "name") || undefined);
  revalidatePath("/", "layout");
  redirect(withFlash("/settings", "Program details saved."));
}

export async function updateComplianceAction(fd: FormData) {
  const { ctx } = await requireSession();
  const dates: Record<string, string> = {};
  for (const [k, v] of fd.entries()) {
    const m = k.match(/^firstContact_(\d{4})$/);
    if (m && String(v).trim()) dates[m[1]] = String(v).trim();
  }
  const calendar = str(fd, "calendar")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [start, end, type, ...note] = l.split(",").map((x) => x.trim());
      return { start, end, type: type as "dead", note: note.join(", ") || undefined };
    })
    .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.start) && /^\d{4}-\d{2}-\d{2}$/.test(p.end) && ["contact", "evaluation", "quiet", "dead"].includes(p.type));
  await updateOrgSettings(ctx, {
    compliance: {
      configured: Boolean(str(fd, "configured")),
      division: str(fd, "division") || null,
      firstContactDateByGradYear: dates,
      calendar,
      requireGuardianConsentForMinors: Boolean(str(fd, "requireGuardianConsent")),
      campMaterialsAllowedBeforeContactDate: Boolean(str(fd, "campMaterialsAllowed")),
    },
  });
  revalidatePath("/settings");
  redirect(withFlash("/settings#compliance", "Compliance settings saved."));
}

export async function updateOutreachSettingsAction(fd: FormData) {
  const { ctx } = await requireSession();
  await updateOrgSettings(ctx, { emailSendingEnabled: Boolean(str(fd, "emailSendingEnabled")), programDisplayName: str(fd, "programDisplayName") || undefined });
  revalidatePath("/settings");
  redirect(withFlash("/settings#outreach", "Outreach settings saved."));
}

export async function updateAssumptionsAction(fd: FormData) {
  const { ctx } = await requireSession();
  const minutes: Record<string, number> = {};
  for (const [k, v] of fd.entries()) {
    const m = k.match(/^min_(\w+)$/);
    if (m && Number.isFinite(Number(v)) && Number(v) >= 0) minutes[m[1]] = Number(v);
  }
  await updateOrgSettings(ctx, { minutesPerTask: minutes });
  revalidatePath("/impact");
  redirect(withFlash("/impact", "Time-savings assumptions updated."));
}

export async function importCsvAction(fd: FormData) {
  const { ctx, user, org } = await requireSession();
  authorize(ctx, "import_data");
  if (!str(fd, "attest")) redirect(withFlash("/settings#sources", "Confirm your program is authorized to use this data before importing.", "err"));
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) redirect(withFlash("/settings#sources", "Choose a CSV file to import.", "err"));
  const text = await file.text();
  const kind = str(fd, "kind");
  const parsed = kind === "schedule" ? parseScheduleCsv(text) : parseAthleteCsv(text);
  if (parsed.records.length === 0) redirect(withFlash("/settings#sources", parsed.errors.join(" ") || "No rows found.", "err"));
  const source = await createSource(ctx.db, ctx.orgId, {
    providerId: "csv_import",
    name: `${str(fd, "sourceName") || file.name} (CSV ${kind === "schedule" ? "schedule " : ""}import)`,
    kind: "import",
    status: "connected",
    statusDetail: `Imported ${parsed.records.length} records by ${user.name} on ${new Date().toISOString().slice(0, 10)}`,
    attestedBy: user.id,
    config: { fileName: file.name, kind },
  });
  const stats = await ingestRecords(ctx.db, ctx.orgId, source, parsed.records, { isDemo: org.isDemo, sport: org.sport, createMissing: kind !== "schedule" });
  await logEvent(ctx.db, ctx.orgId, { type: "import_completed", message: `Imported ${file.name}: ${describeIngest(stats)}`, sourceId: source.id, detail: { stats, errors: parsed.errors.slice(0, 50) } });
  await audit(ctx, "import_csv", "source", source.id, { fileName: file.name, stats, errorCount: parsed.errors.length });
  revalidatePath("/", "layout");
  const warn = parsed.errors.length ? ` ${parsed.errors.length} warnings: ${parsed.errors.slice(0, 3).join(" ")}` : "";
  const skipped = kind === "schedule" && stats.skipped ? ` ${stats.skipped} schedule rows didn't match a known athlete and were skipped.` : "";
  redirect(withFlash("/settings#sources", `Import complete: ${describeIngest(stats)}.${skipped}${warn}`));
}

export async function syncSourcesAction() {
  const { ctx, org } = await requireSession();
  authorize(ctx, "run_missions");
  const r = await syncSources(ctx.db, org, null);
  await audit(ctx, "sync_sources", "org", ctx.orgId, r);
  revalidatePath("/", "layout");
  redirect(withFlash("/settings#sources", `Checked ${r.sourcesChecked} connected sources (${r.sourcesFailed} failed): ${describeIngest(r.ingest)}.`));
}

export async function inviteUserAction(fd: FormData) {
  const { ctx } = await requireSession();
  authorize(ctx, "manage_users");
  try {
    const id = await createUser(ctx.db, ctx.orgId, { email: str(fd, "email"), name: str(fd, "name"), title: str(fd, "title") || null, role: str(fd, "role") as Role, password: str(fd, "password") });
    await audit(ctx, "create_user", "user", id, { role: str(fd, "role") });
  } catch (e) {
    redirect(withFlash("/settings#team", e instanceof Error ? e.message : "Failed", "err"));
  }
  revalidatePath("/settings");
  redirect(withFlash("/settings#team", "Staff member added. Share their temporary password with them directly."));
}

export async function deleteAthleteAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "athleteId");
  if (str(fd, "confirm").toUpperCase() !== "DELETE") redirect(withFlash(`/athletes/${id}`, 'Type DELETE to confirm permanent removal.', "err"));
  try {
    await deleteAthleteData(ctx, id, str(fd, "reason"));
  } catch (e) {
    redirect(withFlash(`/athletes/${id}`, e instanceof Error ? e.message : "Failed", "err"));
  }
  revalidatePath("/", "layout");
  redirect(withFlash("/following", "Athlete and all related records were permanently deleted. The deletion is recorded in the audit log."));
}
