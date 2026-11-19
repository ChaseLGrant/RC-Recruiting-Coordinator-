import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "./db";
import { userForSession } from "./auth";
import { getOrg, type Ctx, type Org, type User } from "./repo";

export const SESSION_COOKIE = "rc_session";

export async function currentUser(): Promise<User | null> {
  const db = await getDb();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return userForSession(db, token);
}

export async function requireSession(): Promise<{ ctx: Ctx; user: User; org: Org }> {
  const db = await getDb();
  const user = await currentUser();
  if (!user) redirect("/login");
  const org = await getOrg(db, user.orgId);
  return { ctx: { db, orgId: user.orgId, userId: user.id, role: user.role }, user, org };
}
