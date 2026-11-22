import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "./db";
import { sessionInfo, type SessionInfo } from "./auth";
import { getOrg, type Ctx, type Org, type User } from "./repo";
import { billingState } from "./billing/plan";
import { isOwner } from "./billing/schools";

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
  const org = await getOrg(db, user.orgId);
  // Schools without an active trial or subscription go to Billing (their data is kept).
  // (RC owners are never locked out — they need /admin to run the business.)
  if (!opts.allowInactive && !billingState(org).active && !isOwner(user.email)) redirect("/billing");
  return { ctx: { db, orgId: user.orgId, userId: user.id, role: user.role }, user, org, shared: s.login.isShared };
}
