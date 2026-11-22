// Throwaway demos ("Try RC now" and school preview links) are private,
// fictional workspaces. They don't run scheduled jobs, and they're deleted
// after a couple of weeks. The school's open/view counts are kept.

import type { Db } from "../db";
import { SCHEMA } from "../db/schema";
import { GUEST_EMAIL_DOMAIN } from "../onboarding";

export const GUEST_DEMO_DAYS = () => Math.max(1, Number(process.env.RC_GUEST_DEMO_DAYS ?? 14));

export async function isThrowawayDemo(db: Db, orgId: string): Promise<boolean> {
  return Boolean(await db.get("SELECT 1 AS x FROM users WHERE org_id = ? AND email LIKE ? LIMIT 1", [orgId, `%@${GUEST_EMAIL_DOMAIN}`]));
}

/** Tables holding org data, children first, so deletes respect foreign keys. */
function orgTables(): string[] {
  const names: string[] = [];
  for (const sql of SCHEMA) {
    const m = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*)\)/);
    if (m && m[1] !== "orgs" && m[1] !== "prospect_demos" && /\borg_id\b/.test(m[2])) names.push(m[1]);
  }
  return names.reverse();
}

export async function purgeOrg(db: Db, orgId: string): Promise<void> {
  await db.tx(async (tx) => {
    const users = (await tx.all<{ id: string }>("SELECT id FROM users WHERE org_id = ?", [orgId])).map((u) => u.id);
    if (users.length) await tx.run(`DELETE FROM sessions WHERE user_id IN (${users.map(() => "?").join(",")})`, users);
    for (const t of orgTables()) if (t !== "users") await tx.run(`DELETE FROM ${t} WHERE org_id = ?`, [orgId]);
    await tx.run("DELETE FROM users WHERE org_id = ?", [orgId]);
    await tx.run("DELETE FROM orgs WHERE id = ? AND is_demo = 1", [orgId]);
  });
}

export async function purgeOldGuestDemos(db: Db, limit = 50): Promise<number> {
  const cutoff = new Date(Date.now() - GUEST_DEMO_DAYS() * 86_400_000).toISOString();
  const old = await db.all<{ id: string }>(
    "SELECT DISTINCT o.id FROM orgs o JOIN users u ON u.org_id = o.id WHERE o.is_demo = 1 AND u.email LIKE ? AND o.created_at < ? LIMIT ?",
    [`%@${GUEST_EMAIL_DOMAIN}`, cutoff, limit],
  );
  for (const o of old) await purgeOrg(db, o.id);
  return old.length;
}
