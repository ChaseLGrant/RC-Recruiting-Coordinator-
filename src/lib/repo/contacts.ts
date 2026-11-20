// Contact log: every call, text, visit and evaluation the staff has with a
// recruit, in one shared timeline. Programs also use this to keep count of
// contacts for their compliance office.

import { Db, newId, nowIso } from "../db";
import { audit, authorize, getAthlete, logEvent, type Ctx } from "./index";

export const CONTACT_KINDS = {
  call: { label: "Called", verb: "called" },
  text: { label: "Texted", verb: "texted" },
  email: { label: "Emailed", verb: "emailed" },
  dm: { label: "DM'd", verb: "messaged on social" },
  saw_play: { label: "Saw him play", verb: "watched him play" },
  camp: { label: "Came to camp", verb: "came to camp" },
  campus_visit: { label: "Campus visit", verb: "visited campus" },
  in_person: { label: "In person", verb: "met in person" },
  they_reached_out: { label: "He reached out", verb: "reached out to us" },
  other: { label: "Other", verb: "contact" },
} as const;

export type ContactKind = keyof typeof CONTACT_KINDS;

export interface ContactRow {
  id: string;
  athlete_id: string;
  kind: ContactKind;
  occurred_at: string;
  note: string | null;
  user_name: string | null;
  created_at: string;
}

export async function logContact(ctx: Ctx, athleteId: string, c: { kind: string; occurredAt?: string | null; note?: string | null }): Promise<string> {
  authorize(ctx, "note");
  if (!(c.kind in CONTACT_KINDS)) throw new Error("Pick what kind of contact this was.");
  const a = await getAthlete(ctx.db, ctx.orgId, athleteId);
  if (!a) throw new Error("Player not found");
  let when = nowIso();
  if (c.occurredAt) {
    const t = Date.parse(c.occurredAt);
    if (Number.isNaN(t)) throw new Error("That date doesn't look right.");
    if (t > Date.now() + 86_400_000) throw new Error("Contacts are logged after they happen; pick today or an earlier date.");
    when = new Date(t).toISOString();
  }
  const id = newId();
  await ctx.db.run("INSERT INTO contacts (id, org_id, athlete_id, user_id, kind, occurred_at, note, created_at) VALUES (?,?,?,?,?,?,?,?)", [
    id, ctx.orgId, athleteId, ctx.userId, c.kind, when, c.note?.trim().slice(0, 2000) || null, nowIso(),
  ]);
  await audit(ctx, "log_contact", "athlete", athleteId, { kind: c.kind });
  await logEvent(ctx.db, ctx.orgId, { type: "coach_action", message: `${CONTACT_KINDS[c.kind as ContactKind].label}: ${a.firstName} ${a.lastName}`, athleteId });
  return id;
}

export async function deleteContact(ctx: Ctx, contactId: string) {
  authorize(ctx, "note");
  // Staff can remove their own entries; the head coach can remove any.
  const row = await ctx.db.get<{ user_id: string | null }>("SELECT user_id FROM contacts WHERE org_id = ? AND id = ?", [ctx.orgId, contactId]);
  if (!row) throw new Error("Entry not found");
  if (row.user_id !== ctx.userId && ctx.role !== "head_coach" && ctx.role !== "system") throw new Error("Only the coach who logged this, or the head coach, can remove it.");
  await ctx.db.run("DELETE FROM contacts WHERE org_id = ? AND id = ?", [ctx.orgId, contactId]);
  await audit(ctx, "delete_contact", "contact", contactId);
}

export async function listContacts(db: Db, orgId: string, athleteId: string): Promise<ContactRow[]> {
  return db.all<ContactRow>(
    "SELECT c.*, u.name AS user_name FROM contacts c LEFT JOIN users u ON u.id = c.user_id WHERE c.org_id = ? AND c.athlete_id = ? ORDER BY c.occurred_at DESC, c.created_at DESC",
    [orgId, athleteId],
  );
}

/** Most recent contact per player, for cards and lists. */
export async function lastContacts(db: Db, orgId: string, athleteIds: string[]): Promise<Map<string, ContactRow>> {
  if (athleteIds.length === 0) return new Map();
  const rows = await db.all<ContactRow>(
    `SELECT c.*, u.name AS user_name FROM contacts c LEFT JOIN users u ON u.id = c.user_id WHERE c.org_id = ? AND c.athlete_id IN (${athleteIds.map(() => "?").join(",")}) ORDER BY c.occurred_at DESC`,
    [orgId, ...athleteIds],
  );
  const out = new Map<string, ContactRow>();
  for (const r of rows) if (!out.has(r.athlete_id)) out.set(r.athlete_id, r);
  return out;
}

export async function contactCounts(db: Db, orgId: string, athleteId: string): Promise<Record<string, number>> {
  const rows = await db.all<{ kind: string; n: number }>("SELECT kind, COUNT(*) AS n FROM contacts WHERE org_id = ? AND athlete_id = ? GROUP BY kind", [orgId, athleteId]);
  return Object.fromEntries(rows.map((r) => [r.kind, Number(r.n)]));
}
