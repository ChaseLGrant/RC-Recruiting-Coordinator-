import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "./db";
import { sessionInfo, type SessionInfo } from "./auth";
import { getOrg, type Ctx, type Org, type User } from "./repo";
import { ensureTrialStarted } from "./billing/plan";

export const SESSION_COOKIE = "rc_session";

export async function currentSession(): Promise<SessionInfo | null> {
  const db = await getDb();
  return sessionInfo(db, (await cookies()).get(SESSION_COOKIE)?.value);
}

/** The person using RC right now (null if signed out). */
export async function currentUser(): Promise<User | null> {
  const s = await currentSession();
  return s ? (s.acting ?? s.login) : null;
}

export async function requireSession(opts: { allowInactive?: boolean } = {}): Promise<{ ctx: Ctx; user: User; org: Org; shared: boolean }> {
  const db = await getDb();
  const s = await currentSession();
  if (!s) redirect("/login");
  // Shared staff login: everyone picks their name first so their work is attributed.
  if (!s.acting) redirect("/who");
  const user = s.acting;
  // Coaches are never locked out of their own board. The first visit starts
  // the school's free trial of RC's automatic updates (no card needed).
  const org = await ensureTrialStarted(db, await getOrg(db, user.orgId));
  void opts;
  return { ctx: { db, orgId: user.orgId, userId: user.id, role: user.role }, user, org, shared: s.login.isShared };
}
