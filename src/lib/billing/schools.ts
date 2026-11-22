// RC owners create a branded school and send its head coach a one-time
// invite link. The head coach sets up the staff from that link, then starts
// the free trial (card on file, charged automatically when it ends).

import { createHash, randomBytes } from "node:crypto";
import { Db, newId, nowIso } from "../db";
import { addStaffProfile, createUser, setSharedLogin } from "../auth";
import { geocode } from "../domain/geo";
import { PROVIDERS } from "../providers/registry";
import { createSource, getOrg, sanitizeBranding, updateOrgSettings, type Branding } from "../repo";
import type { Role } from "../domain/types";

export function isOwner(email: string, env: Record<string, string | undefined> = process.env): boolean {
  return (env.RC_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean).includes(email.trim().toLowerCase());
}

const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const INVITE_DAYS = 30;

export async function createSchool(db: Db, s: { programName: string; teamName?: string | null; campusZip: string; sport?: string; branding?: Partial<Branding> }): Promise<string> {
  if (!s.programName.trim()) throw new Error("Enter the program name.");
  const campus = geocode(s.campusZip);
  if (!campus) throw new Error(`Couldn't find "${s.campusZip}". Use the campus ZIP code.`);
  const orgId = newId();
  await db.run("INSERT INTO orgs (id, name, sport, campus_label, campus_lat, campus_lng, is_demo, settings_json, created_at) VALUES (?,?,?,?,?,?,0,'{}',?)", [
    orgId, s.programName.trim(), s.sport ?? "baseball", `Campus (${campus.label})`, campus.lat, campus.lng, nowIso(),
  ]);
  for (const prov of PROVIDERS.filter((x) => x.kind === "licensed_api")) {
    const st = prov.status(process.env, { isDemo: false });
    await createSource(db, orgId, { providerId: prov.id, name: prov.name, kind: prov.kind, status: st.status, statusDetail: st.detail });
  }
  await updateOrgSettings({ db, orgId, userId: null, role: "system" }, {
    branding: sanitizeBranding({ ...s.branding, teamName: s.teamName?.trim() || null }),
    programDisplayName: s.teamName?.trim() || undefined,
  });
  return orgId;
}

export async function createInvite(db: Db, orgId: string, createdBy: string | null): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await db.run("INSERT INTO invites (id, org_id, created_by, expires_at, created_at) VALUES (?,?,?,?,?)", [
    hash(token), orgId, createdBy, new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString(), nowIso(),
  ]);
  return token;
}

export async function inviteInfo(db: Db, token: string) {
  const r = await db.get<{ org_id: string; expires_at: string; used_at: string | null }>("SELECT org_id, expires_at, used_at FROM invites WHERE id = ?", [hash(token)]);
  if (!r) return { ok: false as const, reason: "This invite link isn't valid. Ask the RC team for a new one." };
  if (r.used_at) return { ok: false as const, reason: "This invite link was already used. Sign in instead." };
  if (r.expires_at < nowIso()) return { ok: false as const, reason: "This invite link has expired. Ask the RC team for a new one." };
  return { ok: true as const, org: await getOrg(db, r.org_id) };
}

/** Head coach accepts the invite: personal login + optional shared staff login + staff profiles. */
export async function acceptInvite(
  db: Db,
  token: string,
  a: { name: string; title?: string | null; email: string; password: string; staffLoginEmail?: string | null; staffLoginPassword?: string | null; staff?: Array<{ name: string; title?: string | null; role?: Role }> },
): Promise<{ orgId: string; userId: string }> {
  const info = await inviteInfo(db, token);
  if (!info.ok) throw new Error(info.reason);
  const orgId = info.org.id;
  return db.tx(async (tdb) => {
    // Claim the invite first so a double-submit can't create two head coaches.
    const claimed = await tdb.run("UPDATE invites SET used_at = ? WHERE id = ? AND used_at IS NULL", [nowIso(), hash(token)]);
    if (claimed.changes !== 1) throw new Error("This invite link was already used. Sign in instead.");
    const userId = await createUser(tdb, orgId, { email: a.email, name: a.name, title: a.title ?? "Head Coach", role: "head_coach", password: a.password });
    for (const s of a.staff ?? []) if (s.name.trim()) await addStaffProfile(tdb, orgId, { name: s.name, title: s.title ?? null, role: s.role ?? "assistant_coach" });
    if (a.staffLoginEmail) {
      // The staff login gets its own password: assistants must never know the head coach's.
      if (!a.staffLoginPassword || a.staffLoginPassword === a.password) throw new Error("Choose a different password for the staff login than your own.");
      await setSharedLogin(tdb, orgId, a.staffLoginEmail, a.staffLoginPassword, info.org.settings.branding.teamName ?? info.org.name);
    }
    return { orgId, userId };
  });
}
