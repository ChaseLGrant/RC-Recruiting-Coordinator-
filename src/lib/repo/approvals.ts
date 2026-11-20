// "Needs Your Approval" — every consequential action RC prepares lands here
// first. Nothing external happens until a coach (or compliance) decides.

import { Db, newId, nowIso, parseJson, Row } from "../db";
import { checkEligibility, type MessageKind } from "../domain/compliance";
import { draftMessage } from "../domain/outreach";
import { resolveAll } from "../domain/provenance";
import { audit, authorize, Ctx, getAthlete, getOrg, listObservations, logEvent, setFollow } from "./index";
import { getEmailProvider } from "../providers/email";
import { safeUrl } from "../domain/urls";

export type ApprovalKind =
  | "prospect" // new priority prospect recommendation
  | "board_change" // proposed recruiting board change
  | "outreach" // personalized outreach draft
  | "camp_list" // camp invitation list
  | "itinerary" // scouting itinerary suggestion
  | "data_conflict" // conflicting athlete data / possible duplicate
  | "compliance"; // compliance warning needing review

export const APPROVAL_KIND_LABEL: Record<ApprovalKind, string> = {
  prospect: "New prospect",
  board_change: "Board change",
  outreach: "Outreach draft",
  camp_list: "Camp invitation list",
  itinerary: "Scouting itinerary",
  data_conflict: "Data conflict",
  compliance: "Compliance review",
};

export type ApprovalStatus = "pending" | "approved" | "rejected" | "saved";

export interface Approval {
  id: string;
  kind: ApprovalKind;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  status: ApprovalStatus;
  athleteId: string | null;
  runId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

function approvalFromRow(r: Row): Approval {
  return {
    id: String(r.id),
    kind: r.kind as ApprovalKind,
    title: String(r.title),
    summary: String(r.summary),
    payload: parseJson(r.payload_json, {}),
    status: r.status as ApprovalStatus,
    athleteId: (r.athlete_id as string) ?? null,
    runId: (r.run_id as string) ?? null,
    decidedBy: (r.decided_by as string) ?? null,
    decidedAt: (r.decided_at as string) ?? null,
    decisionNote: (r.decision_note as string) ?? null,
    createdAt: String(r.created_at),
  };
}

/** Creates an approval unless one with the same dedupe key already exists. Returns null if deduped. */
export async function createApproval(
  db: Db,
  orgId: string,
  a: { kind: ApprovalKind; title: string; summary: string; payload: object; dedupeKey?: string; athleteId?: string | null; runId?: string | null },
): Promise<string | null> {
  if (a.dedupeKey) {
    const existing = await db.get("SELECT id FROM approvals WHERE org_id = ? AND dedupe_key = ?", [orgId, a.dedupeKey]);
    if (existing) return null;
  }
  const id = newId();
  await db.run(
    "INSERT INTO approvals (id, org_id, kind, title, summary, payload_json, status, dedupe_key, athlete_id, run_id, created_at) VALUES (?,?,?,?,?,?,'pending',?,?,?,?)",
    [id, orgId, a.kind, a.title, a.summary, JSON.stringify(a.payload), a.dedupeKey ?? null, a.athleteId ?? null, a.runId ?? null, nowIso()],
  );
  return id;
}

export async function listApprovals(db: Db, orgId: string, statuses: ApprovalStatus[] = ["pending"], limit = 200): Promise<Approval[]> {
  return (
    await db.all(
      `SELECT * FROM approvals WHERE org_id = ? AND status IN (${statuses.map(() => "?").join(",")}) ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, CASE kind WHEN 'compliance' THEN 0 WHEN 'prospect' THEN 1 WHEN 'camp_list' THEN 2 WHEN 'outreach' THEN 3 WHEN 'board_change' THEN 4 WHEN 'itinerary' THEN 5 ELSE 6 END, created_at DESC LIMIT ?`,
      [orgId, ...statuses, limit],
    )
  ).map(approvalFromRow);
}

export async function getApproval(db: Db, orgId: string, id: string): Promise<Approval | null> {
  const r = await db.get("SELECT * FROM approvals WHERE org_id = ? AND id = ?", [orgId, id]);
  return r ? approvalFromRow(r) : null;
}

export type Decision = "approve" | "reject" | "save";

export interface DecisionInput {
  decision: Decision;
  note?: string;
  /** For outreach: coach-edited subject/body. */
  edits?: { subject?: string; body?: string };
}

export async function decideApproval(ctx: Ctx, approvalId: string, input: DecisionInput): Promise<{ result: string }> {
  const a = await getApproval(ctx.db, ctx.orgId, approvalId);
  if (!a) throw new Error("Approval item not found");
  authorize(ctx, a.kind === "compliance" ? "decide_compliance" : "decide_approvals");
  if (a.status === "approved" || a.status === "rejected") throw new Error("This item was already decided");

  const status: ApprovalStatus = input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : "saved";
  let result = status === "saved" ? "Saved for later" : status === "rejected" ? "Rejected" : "Approved";

  await ctx.db.tx(async (db) => {
    const tctx = { ...ctx, db };
    if (input.decision === "approve") result = await applyApproval(tctx, a, input);
    if (input.decision === "reject" && a.kind === "outreach" && a.payload.messageId) {
      await db.run("UPDATE messages SET status = 'rejected', updated_at = ? WHERE org_id = ? AND id = ?", [nowIso(), ctx.orgId, String(a.payload.messageId)]);
    }
    if (input.edits && a.kind === "outreach" && a.payload.messageId && input.decision !== "reject") {
      await db.run("UPDATE messages SET subject = COALESCE(?, subject), body = COALESCE(?, body), updated_at = ? WHERE org_id = ? AND id = ?", [
        input.edits.subject ?? null, input.edits.body ?? null, nowIso(), ctx.orgId, String(a.payload.messageId),
      ]);
    }
    await db.run("UPDATE approvals SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE org_id = ? AND id = ?", [
      status, ctx.userId, nowIso(), input.note ?? null, ctx.orgId, a.id,
    ]);
    await audit(tctx, `approval_${input.decision}`, "approval", a.id, { kind: a.kind, edited: Boolean(input.edits), result });
    await logEvent(db, ctx.orgId, { type: "coach_action", message: `${result}: ${a.title}`, athleteId: a.athleteId });
  });
  return { result };
}

async function applyApproval(ctx: Ctx, a: Approval, input: DecisionInput): Promise<string> {
  switch (a.kind) {
    case "prospect":
    case "board_change": {
      if (!a.athleteId) return "Approved";
      await setFollow(ctx, a.athleteId, true, String(a.payload.boardStatus ?? "watching"));
      return "Added to Following";
    }
    case "outreach": {
      const messageId = String(a.payload.messageId ?? "");
      if (input.edits) {
        await ctx.db.run("UPDATE messages SET subject = COALESCE(?, subject), body = COALESCE(?, body) WHERE org_id = ? AND id = ?", [
          input.edits.subject ?? null, input.edits.body ?? null, ctx.orgId, messageId,
        ]);
      }
      return approveMessage(ctx, messageId);
    }
    case "camp_list": {
      const campId = String(a.payload.campId ?? "");
      const athleteIds = (a.payload.athleteIds as string[]) ?? [];
      const counts = { approved: 0, review: 0, blocked: 0 };
      for (const athleteId of athleteIds) {
        const msg = await prepareDraft(ctx, { athleteId, kind: "camp_invite", campId, viaApproval: false });
        const r = await approveMessage(ctx, msg.messageId);
        if (r.startsWith("Blocked")) counts.blocked++;
        else if (r.startsWith("Sent to compliance")) counts.review++;
        else counts.approved++;
        await ctx.db.run("UPDATE camp_targets SET status = 'invite_approved', updated_at = ? WHERE org_id = ? AND camp_id = ? AND athlete_id = ?", [
          nowIso(), ctx.orgId, campId, athleteId,
        ]);
      }
      return `${counts.approved} invitations approved, ${counts.review} sent to compliance review, ${counts.blocked} blocked`;
    }
    case "compliance": {
      // Compliance officer clears a held message: it becomes approved (still not auto-sent).
      const messageId = String(a.payload.messageId ?? "");
      await ctx.db.run("UPDATE messages SET status = 'approved', status_reason = 'Cleared by compliance', updated_at = ? WHERE org_id = ? AND id = ?", [
        nowIso(), ctx.orgId, messageId,
      ]);
      return "Cleared by compliance — ready to send";
    }
    case "data_conflict": {
      if (a.payload.type === "possible_duplicate" && a.payload.keepId && a.payload.dropId) {
        await mergeAthletes(ctx, String(a.payload.keepId), String(a.payload.dropId));
        return "Records merged";
      }
      return "Acknowledged — both values remain visible in Evidence Mode";
    }
    case "itinerary":
      return "Itinerary saved";
  }
}

// ---------- outreach ----------

export async function prepareDraft(
  ctx: Ctx,
  opts: { athleteId: string; kind: MessageKind; campId?: string | null; viaApproval?: boolean; runId?: string | null },
): Promise<{ messageId: string; approvalId: string | null }> {
  authorize(ctx, "decide_approvals");
  const org = await getOrg(ctx.db, ctx.orgId);
  const athlete = await getAthlete(ctx.db, ctx.orgId, opts.athleteId);
  if (!athlete) throw new Error("Athlete not found");
  const obs = await listObservations(ctx.db, ctx.orgId, [athlete.id]);
  const resolved = Array.from(resolveAll(obs).values());
  const camp = opts.campId
    ? await ctx.db.get<{ name: string; starts_at: string; location: string | null; registration_url: string | null }>(
        "SELECT * FROM camps WHERE org_id = ? AND id = ?",
        [ctx.orgId, opts.campId],
      )
    : undefined;
  const coach = ctx.userId
    ? await ctx.db.get<{ name: string; title: string | null }>("SELECT name, title FROM users WHERE id = ? AND org_id = ?", [ctx.userId, ctx.orgId])
    : await ctx.db.get<{ name: string; title: string | null }>("SELECT name, title FROM users WHERE org_id = ? AND role = 'head_coach' ORDER BY created_at LIMIT 1", [ctx.orgId]);
  const nextGame = await ctx.db.get<{ opponent: string | null; starts_at: string }>(
    "SELECT opponent, starts_at FROM games WHERE org_id = ? AND athlete_id = ? AND starts_at > ? AND status != 'cancelled' ORDER BY starts_at LIMIT 1",
    [ctx.orgId, athlete.id, nowIso()],
  );

  const draft = draftMessage({
    kind: opts.kind,
    athlete,
    program: { name: org.settings.programDisplayName ?? org.name, coachName: coach?.name ?? "Coach", coachTitle: coach?.title ?? undefined },
    metrics: resolved,
    camp: camp ? { name: camp.name, startsAt: camp.starts_at, location: camp.location, registrationUrl: camp.registration_url } : null,
    upcomingGame: nextGame ? { opponent: nextGame.opponent, startsAt: nextGame.starts_at } : null,
  });

  const messageId = newId();
  const now = nowIso();
  await ctx.db.run(
    "INSERT INTO messages (id, org_id, athlete_id, camp_id, kind, subject, body, to_email, status, status_reason, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,'draft',?,?,?,?)",
    [messageId, ctx.orgId, athlete.id, opts.campId ?? null, opts.kind, draft.subject, draft.body, athlete.email ?? athlete.guardianEmail, `Facts used: ${draft.factsUsed.join("; ") || "none"}`, ctx.userId, now, now],
  );
  await logEvent(ctx.db, ctx.orgId, { type: "draft_prepared", message: `Prepared ${opts.kind.replace("_", " ")} draft for ${athlete.firstName} ${athlete.lastName}`, athleteId: athlete.id, runId: opts.runId });

  let approvalId: string | null = null;
  if (opts.viaApproval !== false) {
    const elig = checkEligibility(opts.kind, recipientFacts(athlete), org.settings.compliance);
    approvalId = await createApproval(ctx.db, ctx.orgId, {
      kind: "outreach",
      title: `${labelForKind(opts.kind)} — ${athlete.firstName} ${athlete.lastName}`,
      summary: `${draft.subject}. Compliance pre-check: ${elig.status.replace("_", " ")}${elig.status !== "eligible" ? ` (${elig.reasons.join("; ")})` : ""}.`,
      payload: { messageId, factsUsed: draft.factsUsed, eligibility: elig },
      athleteId: athlete.id,
      runId: opts.runId,
    });
    await ctx.db.run("UPDATE messages SET approval_id = ? WHERE id = ?", [approvalId, messageId]);
  }
  return { messageId, approvalId };
}

function labelForKind(k: MessageKind) {
  return { initial: "Initial outreach", follow_up: "Follow-up", camp_invite: "Camp invitation", film_request: "Film request", schedule_request: "Schedule request", general: "Program update" }[k];
}

function recipientFacts(a: NonNullable<Awaited<ReturnType<typeof getAthlete>>>) {
  return {
    gradYear: a.gradYear,
    email: a.email,
    guardianEmail: a.guardianEmail,
    optedOut: a.optedOut,
    contactConsent: a.contactConsent,
    isMinor: a.isMinor,
  };
}

/** Coach approves a message: re-check compliance; approved messages are NOT sent automatically. */
export async function approveMessage(ctx: Ctx, messageId: string): Promise<string> {
  const msg = await ctx.db.get<{ id: string; athlete_id: string; kind: MessageKind; subject: string }>(
    "SELECT * FROM messages WHERE org_id = ? AND id = ?",
    [ctx.orgId, messageId],
  );
  if (!msg) throw new Error("Message not found");
  const org = await getOrg(ctx.db, ctx.orgId);
  const athlete = await getAthlete(ctx.db, ctx.orgId, msg.athlete_id);
  if (!athlete) throw new Error("Athlete not found");
  const elig = checkEligibility(msg.kind, recipientFacts(athlete), org.settings.compliance);
  const now = nowIso();
  if (elig.status === "blocked") {
    await ctx.db.run("UPDATE messages SET status = 'blocked', status_reason = ?, updated_at = ? WHERE id = ?", [elig.reasons.join("; "), now, messageId]);
    return `Blocked: ${elig.reasons.join("; ")}`;
  }
  if (elig.status === "compliance_review") {
    await ctx.db.run("UPDATE messages SET status = 'compliance_review', status_reason = ?, updated_at = ? WHERE id = ?", [elig.reasons.join("; "), now, messageId]);
    await createApproval(ctx.db, ctx.orgId, {
      kind: "compliance",
      title: `Compliance review: ${labelForKind(msg.kind)} to ${athlete.firstName} ${athlete.lastName}`,
      summary: elig.reasons.join("; "),
      payload: { messageId, reasons: elig.reasons },
      dedupeKey: `compliance:${messageId}`,
      athleteId: athlete.id,
    });
    return `Sent to compliance review: ${elig.reasons.join("; ")}`;
  }
  await ctx.db.run("UPDATE messages SET status = 'approved', status_reason = ?, updated_at = ? WHERE id = ?", ["Approved by coach; compliance checks passed", now, messageId]);
  return "Approved — ready to send";
}

/** Explicit send. Only possible when the program enabled sending AND an email provider is connected. */
export async function sendMessage(ctx: Ctx, messageId: string): Promise<string> {
  authorize(ctx, "send_messages");
  const msg = await ctx.db.get<{ id: string; status: string; to_email: string | null; subject: string; body: string; athlete_id: string; kind: MessageKind }>(
    "SELECT * FROM messages WHERE org_id = ? AND id = ?",
    [ctx.orgId, messageId],
  );
  if (!msg) throw new Error("Message not found");
  if (msg.status !== "approved") throw new Error("Only approved messages can be sent");
  const org = await getOrg(ctx.db, ctx.orgId);
  // Re-check at send time: consent or calendars may have changed since approval.
  const athlete = await getAthlete(ctx.db, ctx.orgId, msg.athlete_id);
  if (!athlete) throw new Error("Athlete not found");
  const elig = checkEligibility(msg.kind, recipientFacts(athlete), org.settings.compliance);
  // Hard blocks (opt-out, denied consent, no address) can never be overridden — not even by an earlier compliance clearance.
  if (elig.status === "blocked") {
    await ctx.db.run("UPDATE messages SET status = 'blocked', status_reason = ?, updated_at = ? WHERE id = ?", [elig.reasons.join("; "), nowIso(), messageId]);
    throw new Error(`Not sent: ${elig.reasons.join("; ")}`);
  }
  if (elig.status !== "eligible" && !(await ctx.db.get("SELECT id FROM approvals WHERE org_id = ? AND dedupe_key = ? AND status = 'approved'", [ctx.orgId, `compliance:${messageId}`]))) {
    throw new Error(`Not sent: ${elig.reasons.join("; ")}`);
  }
  if (!org.settings.emailSendingEnabled) throw new Error("Email sending is turned off for this program (Settings → Outreach).");
  const provider = getEmailProvider();
  if (!provider) throw new Error("No email provider is connected. Copy the message into your own email client instead.");
  if (!msg.to_email) throw new Error("No recipient email on record");
  try {
    const { id } = await provider.send({ to: msg.to_email, subject: msg.subject, text: msg.body });
    await ctx.db.run("UPDATE messages SET status = 'sent', sent_at = ?, provider_message_id = ?, updated_at = ? WHERE id = ?", [nowIso(), id, nowIso(), messageId]);
    await audit(ctx, "send_message", "message", messageId, { provider: provider.name });
    return "Sent";
  } catch (e) {
    await ctx.db.run("UPDATE messages SET status = 'failed', status_reason = ?, updated_at = ? WHERE id = ?", [String(e), nowIso(), messageId]);
    throw e;
  }
}

export async function markMessageSentManually(ctx: Ctx, messageId: string) {
  authorize(ctx, "send_messages");
  const m = await ctx.db.get<{ athlete_id: string }>("SELECT athlete_id FROM messages WHERE org_id = ? AND id = ?", [ctx.orgId, messageId]);
  const a = m ? await getAthlete(ctx.db, ctx.orgId, m.athlete_id) : null;
  if (a?.optedOut) throw new Error("This athlete has opted out of communications.");
  const r = await ctx.db.run("UPDATE messages SET status = 'sent', sent_at = ?, status_reason = 'Sent by coach from own email client', updated_at = ? WHERE org_id = ? AND id = ? AND status = 'approved'", [
    nowIso(), nowIso(), ctx.orgId, messageId,
  ]);
  if (r.changes === 0) throw new Error("Only approved messages can be marked as sent");
  await audit(ctx, "mark_sent_manually", "message", messageId);
}

export interface MessageRow {
  id: string;
  athlete_id: string;
  kind: MessageKind;
  subject: string;
  body: string;
  to_email: string | null;
  status: string;
  status_reason: string | null;
  created_at: string;
  sent_at: string | null;
  camp_id: string | null;
}

export async function listMessages(db: Db, orgId: string, opts: { athleteId?: string; campId?: string } = {}): Promise<MessageRow[]> {
  if (opts.athleteId) return db.all<MessageRow>("SELECT * FROM messages WHERE org_id = ? AND athlete_id = ? ORDER BY created_at DESC", [orgId, opts.athleteId]);
  if (opts.campId) return db.all<MessageRow>("SELECT * FROM messages WHERE org_id = ? AND camp_id = ? ORDER BY created_at DESC", [orgId, opts.campId]);
  return db.all<MessageRow>("SELECT * FROM messages WHERE org_id = ? ORDER BY created_at DESC LIMIT 200", [orgId]);
}

// ---------- duplicates ----------

export async function mergeAthletes(ctx: Ctx, keepId: string, dropId: string) {
  authorize(ctx, "decide_approvals");
  const keep = await getAthlete(ctx.db, ctx.orgId, keepId);
  const drop = await getAthlete(ctx.db, ctx.orgId, dropId);
  if (!keep || !drop) throw new Error("Athlete not found");
  for (const table of ["athlete_source_records", "metric_observations", "film_links", "games", "notes", "messages", "camp_targets", "events", "tracked_pages"]) {
    await ctx.db.run(`UPDATE ${table} SET athlete_id = ? WHERE org_id = ? AND athlete_id = ?`, [keepId, ctx.orgId, dropId]);
  }
  await ctx.db.run("DELETE FROM follows WHERE org_id = ? AND athlete_id = ? AND EXISTS (SELECT 1 FROM follows f WHERE f.org_id = ? AND f.athlete_id = ?)", [ctx.orgId, dropId, ctx.orgId, keepId]);
  await ctx.db.run("UPDATE follows SET athlete_id = ? WHERE org_id = ? AND athlete_id = ?", [keepId, ctx.orgId, dropId]);
  await ctx.db.run("DELETE FROM mission_matches WHERE org_id = ? AND athlete_id = ?", [ctx.orgId, dropId]);
  await ctx.db.run("UPDATE approvals SET athlete_id = ? WHERE org_id = ? AND athlete_id = ?", [keepId, ctx.orgId, dropId]);
  await ctx.db.run("UPDATE athletes SET identity_confidence = 1, updated_at = ? WHERE org_id = ? AND id = ?", [nowIso(), ctx.orgId, keepId]);
  await ctx.db.run("DELETE FROM athletes WHERE org_id = ? AND id = ?", [ctx.orgId, dropId]);
  await audit(ctx, "merge_athletes", "athlete", keepId, { merged: dropId });
}

/** Permanently removes an athlete and every record about them (privacy request / data removal). */
export async function deleteAthleteData(ctx: Ctx, athleteId: string, reason: string) {
  authorize(ctx, "manage_settings");
  if (!reason.trim()) throw new Error("Record a reason for the deletion (e.g. family request).");
  const a = await getAthlete(ctx.db, ctx.orgId, athleteId);
  if (!a) throw new Error("Athlete not found");
  await ctx.db.tx(async (db) => {
    for (const t of ["athlete_source_records", "metric_observations", "film_links", "games", "notes", "messages", "camp_targets", "follows", "mission_matches", "tasks", "approvals", "events", "tracked_pages"]) {
      await db.run(`DELETE FROM ${t} WHERE org_id = ? AND athlete_id = ?`, [ctx.orgId, athleteId]);
    }
    await db.run("DELETE FROM athletes WHERE org_id = ? AND id = ?", [ctx.orgId, athleteId]);
    // The audit entry records THAT data was deleted and why — but not the athlete's personal details.
    await audit({ ...ctx, db }, "delete_athlete_data", "athlete", athleteId, { reason: reason.trim().slice(0, 200) });
  });
}

// ---------- camps ----------

export interface Camp {
  id: string;
  name: string;
  startsAt: string;
  location: string | null;
  registrationUrl: string | null;
  profileId: string | null;
}

export async function listCamps(db: Db, orgId: string): Promise<Camp[]> {
  return (await db.all("SELECT * FROM camps WHERE org_id = ? ORDER BY starts_at", [orgId])).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    startsAt: String(r.starts_at),
    location: (r.location as string) ?? null,
    registrationUrl: (r.registration_url as string) ?? null,
    profileId: (r.profile_id as string) ?? null,
  }));
}

export async function createCamp(ctx: Ctx, c: Omit<Camp, "id">): Promise<string> {
  authorize(ctx, "manage_camps");
  if (c.registrationUrl && !safeUrl(c.registrationUrl)) throw new Error("Registration link must be a normal https:// web address.");
  c = { ...c, registrationUrl: safeUrl(c.registrationUrl) };
  const id = newId();
  await ctx.db.run("INSERT INTO camps (id, org_id, name, starts_at, location, registration_url, profile_id, created_at) VALUES (?,?,?,?,?,?,?,?)", [
    id, ctx.orgId, c.name, c.startsAt, c.location, c.registrationUrl, c.profileId, nowIso(),
  ]);
  await audit(ctx, "create_camp", "camp", id, c);
  return id;
}

export async function listCampTargets(db: Db, orgId: string, campId: string) {
  return db.all<{ athlete_id: string; status: string; created_at: string }>(
    "SELECT athlete_id, status, created_at FROM camp_targets WHERE org_id = ? AND camp_id = ? ORDER BY created_at",
    [orgId, campId],
  );
}

export async function setCampTargetStatus(ctx: Ctx, campId: string, athleteId: string, status: "registered" | "declined" | "attended" | "invite_approved" | "targeted") {
  authorize(ctx, "manage_camps");
  const r = await ctx.db.run("UPDATE camp_targets SET status = ?, updated_at = ? WHERE org_id = ? AND camp_id = ? AND athlete_id = ?", [
    status, nowIso(), ctx.orgId, campId, athleteId,
  ]);
  if (r.changes === 0) throw new Error("Camp target not found");
  await audit(ctx, "camp_target_status", "camp", campId, { athleteId, status });
}
