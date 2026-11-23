"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { authenticate, createSession, createUser, destroySession } from "@/lib/auth";
import { SESSION_COOKIE, requireSession } from "@/lib/session";
import { createDemoWorkspace, createGuestDemo, createProgram } from "@/lib/onboarding";
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
  const [beforeHash, hash = ""] = path.split("#");
  const [base, query = ""] = beforeHash.split("?");
  const qs = new URLSearchParams(query);
  qs.set(kind === "ok" ? "flash" : "error", msg);
  return `${base}?${qs.toString()}${hash ? `#${hash}` : ""}`;
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

export async function tryDemoAction() {
  let userId: string;
  try {
    ({ userId } = await createGuestDemo(await getDb()));
  } catch (e) {
    redirect("/login?error=" + encodeURIComponent(e instanceof Error ? e.message : "Couldn't open the demo."));
  }
  await startSession(userId);
  redirect("/?welcome=demo");
}

export async function openPreviewAction(fd: FormData) {
  const slug = str(fd, "slug");
  let userId: string;
  try {
    const { openPreview } = await import("@/lib/outreach/prospects");
    ({ userId } = await openPreview(await getDb(), slug));
  } catch (e) {
    redirect(`/p/${encodeURIComponent(slug)}?error=` + encodeURIComponent(e instanceof Error ? e.message : "Couldn't open the demo."));
  }
  await startSession(userId);
  redirect("/?welcome=demo");
}

/** From inside a school's demo: "Set this up for real" → the school's own account setup. */
export async function startFromPreviewAction() {
  const { ctx, org } = await requireSession();
  const { prospectForDemo, startFromPreview } = await import("@/lib/outreach/prospects");
  const p = org.isDemo ? await prospectForDemo(ctx.db, org.id) : null;
  if (!p) redirect("/signup");
  let token: string;
  try {
    token = await startFromPreview(ctx.db, p.slug);
  } catch (e) {
    redirect(withFlash("/", e instanceof Error ? e.message : "Couldn't start setup.", "err"));
  }
  const jar = await cookies();
  await destroySession(ctx.db, jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect(`/join/${token}`);
}

export async function logoutAction(fd?: FormData) {
  const db = await getDb();
  const jar = await cookies();
  await destroySession(db, jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect(fd && str(fd, "to") === "/signup" ? "/signup" : "/login");
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
    const acceptIds = fd.has("linksForm") ? fd.getAll("accept").map(String) : undefined;
    const r = await decideApproval(ctx, str(fd, "approvalId"), { decision: str(fd, "decision") as Decision, note: str(fd, "note") || undefined, edits, acceptIds });
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
    phone: str(fd, "phone") || null,
    xHandle: str(fd, "xHandle") || null,
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

export async function updateBrandingAction(fd: FormData) {
  const { ctx, org } = await requireSession();
  const current = org.settings.branding;
  let logoDataUrl = current.logoDataUrl;
  const file = fd.get("logo");
  if (str(fd, "removeLogo")) logoDataUrl = null;
  else if (file instanceof File && file.size > 0) {
    const okTypes = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
    if (!okTypes.includes(file.type)) redirect(withFlash("/settings#branding", "Logo must be a PNG, JPG, WebP or SVG file.", "err"));
    if (file.size > 500_000) redirect(withFlash("/settings#branding", "Logo must be under 500 KB.", "err"));
    logoDataUrl = `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`;
  }
  const { sanitizeBranding } = await import("@/lib/repo");
  await updateOrgSettings(ctx, {
    branding: sanitizeBranding({ teamName: str(fd, "teamName") || null, primary: str(fd, "primary"), ink: str(fd, "ink"), accent: str(fd, "accent"), logoDataUrl }),
  });
  revalidatePath("/", "layout");
  redirect(withFlash("/settings#branding", "Branding saved."));
}

// ---------- season stat tracking ----------

export async function trackPageAction(fd: FormData) {
  const { ctx } = await requireSession();
  const athleteId = str(fd, "athleteId");
  const urls = str(fd, "url").split(/\s+/).filter(Boolean);
  try {
    if (urls.length === 0) throw new Error("Paste the link to the player's stats page.");
    const { addTrackedPage, checkTrackedPages } = await import("@/lib/watch/runner");
    for (const u of urls) await addTrackedPage(ctx, athleteId, u);
    const r = await checkTrackedPages(ctx.db, ctx.orgId, { force: true, athleteId });
    revalidatePath(`/athletes/${athleteId}`);
    redirect(withFlash(`/athletes/${athleteId}`, r.newStats || r.changedStats ? `Linked. RC read ${r.newStats + r.changedStats} stats and will keep them updated automatically.` : "Linked. RC couldn't read stats from that page yet; see the note under Season stats."));
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e;
    redirect(withFlash(`/athletes/${athleteId}`, e instanceof Error ? e.message : "Failed", "err"));
  }
}

export async function untrackPageAction(fd: FormData) {
  const { ctx } = await requireSession();
  const { removeTrackedPage } = await import("@/lib/watch/runner");
  await removeTrackedPage(ctx, str(fd, "pageId"));
  revalidatePath(`/athletes/${str(fd, "athleteId")}`);
}

export async function checkPagesNowAction(fd: FormData) {
  const { ctx } = await requireSession();
  authorize(ctx, "run_missions");
  const athleteId = str(fd, "athleteId") || undefined;
  const { checkTrackedPages } = await import("@/lib/watch/runner");
  const r = await checkTrackedPages(ctx.db, ctx.orgId, { force: true, athleteId });
  revalidatePath("/", "layout");
  redirect(withFlash(athleteId ? `/athletes/${athleteId}` : "/settings#stat-tracking", `Checked ${r.checked} page${r.checked === 1 ? "" : "s"}: ${r.changedStats} stats changed, ${r.newStats} new${r.problems ? `, ${r.problems} need attention` : ""}.`));
}

export async function updateStatTrackingAction(fd: FormData) {
  const { ctx } = await requireSession();
  await updateOrgSettings(ctx, { pageWatch: { enabled: Boolean(str(fd, "enabled")), everyHours: Number(str(fd, "everyHours")) || 12 } });
  revalidatePath("/settings");
  redirect(withFlash("/settings#stat-tracking", "Stat tracking settings saved."));
}

// ---------- import a coach's existing list ----------

export async function stageListAction(fd: FormData) {
  const { ctx } = await requireSession();
  let id: string;
  try {
    const { readUpload, readGoogleSheet, stageImport } = await import("@/lib/import/service");
    const link = str(fd, "sheetUrl");
    const file = fd.get("file");
    let table;
    let name = str(fd, "listName");
    if (file instanceof File && file.size > 0) {
      if (file.size > 10_000_000) throw new Error("That file is over 10 MB. Split it or remove extra tabs.");
      table = await readUpload(file.name, Buffer.from(await file.arrayBuffer()));
      name = name || file.name.replace(/\.(csv|xlsx|tsv|txt)$/i, "");
    } else if (link) {
      table = await readGoogleSheet(link);
      name = name || "Google Sheet";
    } else throw new Error("Choose a file or paste a Google Sheets link.");
    id = await stageImport(ctx, name, table);
  } catch (e) {
    redirect(withFlash("/import", e instanceof Error ? e.message : "Couldn't read that list.", "err"));
  }
  redirect(`/import/${id}`);
}

export async function stagePhotoListAction(fd: FormData) {
  const { ctx } = await requireSession();
  let id: string;
  try {
    const photos = fd.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
    if (photos.length === 0) throw new Error("Take or choose a photo of your list first.");
    const { readRosterPhotos } = await import("@/lib/import/photo");
    const { stageImport } = await import("@/lib/import/service");
    const table = await readRosterPhotos(ctx.db, ctx.orgId, await Promise.all(photos.map(async (f) => ({ bytes: Buffer.from(await f.arrayBuffer()), mediaType: f.type }))));
    id = await stageImport(ctx, str(fd, "listName") || `Photo list ${new Date().toISOString().slice(0, 10)}`, table);
  } catch (e) {
    redirect(withFlash("/import", e instanceof Error ? e.message : "Couldn't read that photo.", "err"));
  }
  redirect(`/import/${id}?from=photo`);
}

export async function confirmListAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "importId");
  const count = Number(str(fd, "columnCount"));
  const mapping = Array.from({ length: count }, (_, i) => (str(fd, `col_${i}`) || "ignore") as import("@/lib/import/mapping").FieldId);
  let msg: string;
  try {
    const { confirmImport } = await import("@/lib/import/service");
    const r = await confirmImport(ctx, id, mapping);
    msg = `Imported ${r.imported} players into My Players (${r.newPlayers} new, ${r.matchedExisting} already in RC)` +
      (r.notesAdded ? `, kept ${r.notesAdded} notes` : "") +
      (r.linksTracked ? `, and RC is now tracking ${r.linksTracked} stats pages` : "") + "." +
      (r.skipped.length ? ` Skipped ${r.skipped.length} rows without a name.` : "") +
      (r.warnings.length ? ` ${r.warnings[0]}` : "");
  } catch (e) {
    redirect(withFlash(`/import/${id}`, e instanceof Error ? e.message : "Import failed", "err"));
  }
  revalidatePath("/", "layout");
  redirect(withFlash("/following", msg));
}

// ---------- shared staff login ----------

export async function pickStaffAction(fd: FormData) {
  const db = await getDb();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");
  const { setActingUser } = await import("@/lib/auth");
  try {
    await setActingUser(db, token, str(fd, "staffId"));
  } catch (e) {
    redirect("/who?error=" + encodeURIComponent(e instanceof Error ? e.message : "Try again"));
  }
  redirect("/");
}

export async function switchStaffAction() {
  const db = await getDb();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");
  const { clearActingUser } = await import("@/lib/auth");
  await clearActingUser(db, token);
  redirect("/who");
}

export async function addStaffProfileAction(fd: FormData) {
  const { ctx } = await requireSession();
  authorize(ctx, "manage_users");
  const { addStaffProfile } = await import("@/lib/auth");
  try {
    const id = await addStaffProfile(ctx.db, ctx.orgId, { name: str(fd, "name"), title: str(fd, "title") || null, role: (str(fd, "role") || "assistant_coach") as Role });
    await audit(ctx, "add_staff_profile", "user", id, { role: str(fd, "role") });
  } catch (e) {
    redirect(withFlash("/settings#team", e instanceof Error ? e.message : "Failed", "err"));
  }
  revalidatePath("/settings");
  redirect(withFlash("/settings#team", "Staff member added. They sign in with the staff login and tap their name."));
}

export async function setSharedLoginAction(fd: FormData) {
  const { ctx, org } = await requireSession();
  authorize(ctx, "manage_users");
  const { setSharedLogin } = await import("@/lib/auth");
  try {
    await setSharedLogin(ctx.db, ctx.orgId, str(fd, "email"), str(fd, "password"), org.settings.branding.teamName ?? org.name);
    await audit(ctx, "set_shared_login", "org", ctx.orgId);
  } catch (e) {
    redirect(withFlash("/settings#team", e instanceof Error ? e.message : "Failed", "err"));
  }
  revalidatePath("/settings");
  redirect(withFlash("/settings#team", "Staff login saved. Share the email and password with your staff."));
}

// ---------- contact log ----------

export async function logContactAction(fd: FormData) {
  const { ctx } = await requireSession();
  const athleteId = str(fd, "athleteId");
  const back = str(fd, "returnTo") || `/athletes/${athleteId}`;
  try {
    const { logContact, CONTACT_KINDS } = await import("@/lib/repo/contacts");
    const kind = str(fd, "kind");
    await logContact(ctx, athleteId, { kind, occurredAt: str(fd, "date") || null, note: str(fd, "note") || null });
    revalidatePath("/", "layout");
    redirect(withFlash(back, `Logged: ${CONTACT_KINDS[kind as keyof typeof CONTACT_KINDS]?.label ?? kind}.`));
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e;
    redirect(withFlash(back, e instanceof Error ? e.message : "Failed", "err"));
  }
}

export async function deleteContactAction(fd: FormData) {
  const { ctx } = await requireSession();
  const { deleteContact } = await import("@/lib/repo/contacts");
  try {
    await deleteContact(ctx, str(fd, "contactId"));
  } catch (e) {
    redirect(withFlash(`/athletes/${str(fd, "athleteId")}`, e instanceof Error ? e.message : "Failed", "err"));
  }
  revalidatePath(`/athletes/${str(fd, "athleteId")}`);
}

// ---------- add a player by hand ----------

export async function addPlayerAction(fd: FormData) {
  const { ctx, user, org } = await requireSession();
  authorize(ctx, "note");
  const first = str(fd, "firstName");
  const last = str(fd, "lastName");
  if (!first || !last) redirect(withFlash("/players/new", "Enter the player's first and last name.", "err"));
  const { listSources, createSource, normalizePhone, normalizeXHandle, setFollow, addNote } = await import("@/lib/repo");
  const { ingestRecords } = await import("@/lib/ingest");
  const { logContact } = await import("@/lib/repo/contacts");
  const { parseHeight } = await import("@/lib/domain/metrics");
  const { normalizeState } = await import("@/lib/domain/geo");
  const { normalizePositions } = await import("@/lib/import/mapping");

  // One "seen by" source per coach, so every number they enter says who saw it.
  const sourceName = `Seen by ${user.name}`;
  const source = (await listSources(ctx.db, ctx.orgId)).find((s) => s.providerId === "manual" && s.name === sourceName)
    ?? (await createSource(ctx.db, ctx.orgId, { providerId: "manual", name: sourceName, kind: "manual", status: "connected", statusDetail: "Players and numbers entered by hand", attestedBy: user.id }));
  const today = new Date().toISOString().slice(0, 10);
  const seenAt = str(fd, "seenAt");
  const metrics: Array<{ key: string; value: number; measuredAt: string; verification: "unverified"; eventName: string }> = [];
  const add = (key: string, v: number | null) => { if (v != null && Number.isFinite(v) && v > 0) metrics.push({ key, value: v, measuredAt: today, verification: "unverified", eventName: seenAt ? `Seen at ${seenAt}` : `Entered by ${user.name}` }); };
  add("height_in", str(fd, "height") ? parseHeight(str(fd, "height")) : null);
  add("weight_lb", str(fd, "weight") ? Number(str(fd, "weight")) : null);
  add("exit_velo_mph", str(fd, "ev") ? Number(str(fd, "ev")) : null);
  add("sixty_yd_sec", str(fd, "sixty") ? Number(str(fd, "sixty")) : null);
  add("fb_velo_mph", str(fd, "fb") ? Number(str(fd, "fb")) : null);
  const positions = normalizePositions(str(fd, "position"));
  const links = str(fd, "links").split(/[\s,]+/).filter(Boolean);
  let athleteId = "";
  await ingestRecords(ctx.db, ctx.orgId, source, [{
    firstName: first, lastName: last,
    gradYear: Number(str(fd, "gradYear")) || null,
    primaryPosition: positions[0] ?? null, secondaryPosition: positions[1] ?? null,
    highSchool: str(fd, "school") || null, team: str(fd, "team") || null,
    city: str(fd, "city") || null, state: normalizeState(str(fd, "state")), 
    phone: normalizePhone(str(fd, "phone")), xHandle: normalizeXHandle(str(fd, "xHandle")),
    email: str(fd, "email") || null,
    metrics, profileUrls: links,
  }], { isDemo: org.isDemo, sport: org.sport, onAthlete: async (_i, id) => { athleteId = id; } });
  if (!athleteId) redirect(withFlash("/players/new", "Couldn't add that player. Check the name and try again.", "err"));

  await setFollow(ctx, athleteId, true, str(fd, "boardStatus") || "watching");
  if (str(fd, "note")) await addNote(ctx, athleteId, str(fd, "note"));
  if (str(fd, "sawPlay")) await logContact(ctx, athleteId, { kind: "saw_play", note: seenAt ? `At ${seenAt}` : null });
  let found = "";
  try {
    const { findPlayerPages } = await import("@/lib/finder/finder");
    const r = await findPlayerPages(ctx.db, ctx.orgId, athleteId);
    if (r.candidates) found = ` RC found ${r.candidates} possible page${r.candidates > 1 ? "s" : ""} for him. Review them below.`;
  } catch { /* searching is best-effort; the player is saved either way */ }
  revalidatePath("/", "layout");
  redirect(withFlash(`/athletes/${athleteId}`, `${first} ${last} added to My Players.${found}`));
}

export async function findPagesAction(fd: FormData) {
  const { ctx } = await requireSession();
  authorize(ctx, "import_data");
  const id = str(fd, "athleteId");
  const { findPlayerPages } = await import("@/lib/finder/finder");
  const r = await findPlayerPages(ctx.db, ctx.orgId, id);
  revalidatePath(`/athletes/${id}`);
  redirect(withFlash(`/athletes/${id}#pages`, !r.searched ? (r.note ?? "Search isn't available.") : r.candidates ? `Found ${r.candidates} possible page${r.candidates > 1 ? "s" : ""}. Keep the ones that are really him.` : r.note ?? "No new pages found this time. RC will look again later.", !r.searched ? "err" : "ok"));
}

export async function decideLinksAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "athleteId");
  const all = fd.getAll("candidateId").map(String);
  const keep = str(fd, "decision") === "none" ? [] : fd.getAll("accept").map(String);
  const { decideCandidates } = await import("@/lib/finder/finder");
  const r = await decideCandidates(ctx, keep, all.filter((c) => !keep.includes(c)));
  revalidatePath("/", "layout");
  redirect(withFlash(`/athletes/${id}#pages`, `Kept ${r.accepted}, dismissed ${r.rejected}.`));
}

// ---------- AI research agent ----------

export async function researchNowAction(fd: FormData) {
  const { ctx } = await requireSession();
  authorize(ctx, "run_missions");
  const id = str(fd, "athleteId");
  const { researchPlayer } = await import("@/lib/agent/crm-agent");
  const r = await researchPlayer(ctx.db, ctx.orgId, id);
  await audit(ctx, "ai_research", "athlete", id, { status: r.status, costCents: r.costCents });
  revalidatePath("/", "layout");
  const msg = r.status === "updates" ? `RC found ${r.proposed} update${r.proposed > 1 ? "s" : ""}. Review them below.` : r.note;
  redirect(withFlash(`/athletes/${id}#research`, msg, r.status === "error" || r.status === "not_configured" || r.status === "not_included" ? "err" : "ok"));
}

export async function updateBoardAction() {
  const { ctx, org } = await requireSession();
  authorize(ctx, "run_missions");
  await updateOrgSettings({ ...ctx, role: "system" }, { agent: { ...org.settings.agent, boardRequestedAt: new Date().toISOString() } });
  const n = await ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM follows WHERE org_id = ? AND board_status != 'not_a_fit'", [ctx.orgId]);
  revalidatePath("/following");
  redirect(withFlash("/following", `RC will research all ${n?.n ?? 0} players on your board over the next few hours (up to ${org.settings.agent.maxPerDay} a day). Updates show up in Needs your OK.`));
}

export async function updateAgentSettingsAction(fd: FormData) {
  const { ctx, org } = await requireSession();
  await updateOrgSettings(ctx, { agent: { ...org.settings.agent, enabled: Boolean(str(fd, "enabled")), everyDays: Number(str(fd, "everyDays")) || 7, maxPerDay: Number(str(fd, "maxPerDay")) || 25 } });
  revalidatePath("/settings");
  redirect(withFlash("/settings#agent", "AI research settings saved."));
}

// ---------- billing ----------

async function baseUrl() {
  if (process.env.RC_PUBLIC_URL) return process.env.RC_PUBLIC_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

export async function startCheckoutAction(fd: FormData) {
  const { ctx, org, user } = await requireSession({ allowInactive: true });
  authorize(ctx, "manage_settings");
  const { getStripe, createCheckoutUrl } = await import("@/lib/billing/stripe");
  const stripe = getStripe();
  if (!stripe) redirect("/billing?error=" + encodeURIComponent("Billing isn't set up yet."));
  let url: string;
  try {
    url = await createCheckoutUrl(stripe, org, { interval: str(fd, "interval") === "year" ? "year" : "month", email: user.email, baseUrl: await baseUrl() });
    await audit(ctx, "billing_checkout_started", "org", ctx.orgId, { interval: str(fd, "interval") });
  } catch (e) {
    redirect("/billing?error=" + encodeURIComponent(e instanceof Error ? e.message : "Couldn't open checkout"));
  }
  redirect(url);
}

export async function billingPortalAction() {
  const { ctx, org } = await requireSession({ allowInactive: true });
  authorize(ctx, "manage_settings");
  const { getStripe, createPortalUrl } = await import("@/lib/billing/stripe");
  const stripe = getStripe();
  if (!stripe) redirect("/billing?error=" + encodeURIComponent("Billing isn't set up yet."));
  let url: string;
  try {
    url = await createPortalUrl(stripe, org, await baseUrl());
  } catch (e) {
    redirect("/billing?error=" + encodeURIComponent(e instanceof Error ? e.message : "Couldn't open billing"));
  }
  redirect(url);
}



// ---------- school invites (head coach) & owner tools ----------

export async function acceptInviteAction(fd: FormData) {
  const token = str(fd, "token");
  const db = await getDb();
  const staff = str(fd, "staff").split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [name, ...title] = l.split(/\s*[,–—-]\s*/);
    return { name: name.trim(), title: title.join(" ").trim() || null, role: "assistant_coach" as Role };
  });
  let userId: string;
  try {
    const { acceptInvite } = await import("@/lib/billing/schools");
    ({ userId } = await acceptInvite(db, token, {
      name: str(fd, "name"), title: str(fd, "title") || null, email: str(fd, "email"), password: str(fd, "password"),
      staffLoginEmail: str(fd, "staffEmail") || null, staffLoginPassword: str(fd, "staffPassword") || null, staff,
    }));
  } catch (e) {
    redirect(`/join/${encodeURIComponent(token)}?error=` + encodeURIComponent(e instanceof Error ? e.message : "Couldn't set up your account"));
  }
  await startSession(userId);
  redirect("/");
}

async function requireOwner() {
  const s = await requireSession({ allowInactive: true });
  const { isOwner } = await import("@/lib/billing/schools");
  if (!isOwner(s.user.email)) redirect("/");
  return s;
}

export async function adminCreateSchoolAction(fd: FormData) {
  const { ctx } = await requireOwner();
  const { createSchool, createInvite } = await import("@/lib/billing/schools");
  let link: string;
  try {
    let logoDataUrl: string | null = null;
    const file = fd.get("logo");
    if (file instanceof File && file.size > 0) {
      if (!["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(file.type) || file.size > 500_000) throw new Error("Logo must be a PNG, JPG, WebP or SVG under 500 KB.");
      logoDataUrl = `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`;
    }
    const orgId = await createSchool(ctx.db, {
      programName: str(fd, "programName"), teamName: str(fd, "teamName") || null, campusZip: str(fd, "campusZip"),
      branding: { primary: str(fd, "primary"), ink: str(fd, "ink"), accent: str(fd, "accent"), logoDataUrl },
    });
    const token = await createInvite(ctx.db, orgId, ctx.userId);
    link = `${await baseUrl()}/join/${token}`;
  } catch (e) {
    redirect(withFlash("/admin", e instanceof Error ? e.message : "Couldn't create the school", "err"));
  }
  revalidatePath("/admin");
  redirect(withFlash("/admin", `School created. Email this one-time link to the head coach (it works once, for 30 days): ${link}`));
}

export async function adminImportProspectsAction(fd: FormData) {
  const { ctx } = await requireOwner();
  const file = fd.get("file");
  let msg: string;
  try {
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose your school list (CSV).");
    if (file.size > 4_000_000) throw new Error("That file is over 4 MB. Split it into smaller lists.");
    const { importProspects } = await import("@/lib/outreach/prospects");
    const r = await importProspects(ctx.db, await file.text(), { baseUrl: await baseUrl() });
    await audit(ctx, "prospects_imported", "org", ctx.orgId, { added: r.added, updated: r.updated });
    msg = `${r.added} schools added, ${r.updated} updated, ${r.logos} logos downloaded.${r.problems.length ? ` ${r.problems.length} notes: ${r.problems.slice(0, 4).join(" ")}${r.problems.length > 4 ? " …" : ""}` : ""}`;
  } catch (e) {
    redirect(withFlash("/admin/outreach", e instanceof Error ? e.message : "Couldn't read that list.", "err"));
  }
  revalidatePath("/admin/outreach");
  redirect(withFlash("/admin/outreach", msg));
}

export async function adminDeleteProspectAction(fd: FormData) {
  const { ctx } = await requireOwner();
  await ctx.db.run("DELETE FROM prospects WHERE id = ? AND org_id IS NULL", [str(fd, "id")]);
  revalidatePath("/admin/outreach");
  redirect(withFlash("/admin/outreach", "Removed."));
}

export async function adminNewInviteAction(fd: FormData) {
  const { ctx } = await requireOwner();
  const { createInvite } = await import("@/lib/billing/schools");
  const token = await createInvite(ctx.db, str(fd, "orgId"), ctx.userId);
  redirect(withFlash("/admin", `New invite link (works once, for 30 days): ${await baseUrl()}/join/${token}`));
}

export async function adminBillingAction(fd: FormData) {
  const { ctx } = await requireOwner();
  const orgId = str(fd, "orgId");
  const { getOrg } = await import("@/lib/repo");
  const target = await getOrg(ctx.db, orgId);
  const paidThrough = str(fd, "paidThrough");
  const plan = {
    ...target.settings.plan,
    comp: Boolean(str(fd, "comp")),
    paidThrough: paidThrough ? new Date(paidThrough + "T23:59:59Z").toISOString() : null,
    aiMonthlyLimit: Math.max(0, Number(str(fd, "aiMonthlyLimit")) || target.settings.plan.aiMonthlyLimit),
  };
  await updateOrgSettings({ db: ctx.db, orgId, userId: ctx.userId, role: "system" }, { plan });
  await audit({ ...ctx, orgId }, "owner_billing_update", "org", orgId, { comp: plan.comp, paidThrough: plan.paidThrough, aiMonthlyLimit: plan.aiMonthlyLimit });
  revalidatePath("/admin");
  redirect(withFlash("/admin", `${target.name} updated.`));
}
