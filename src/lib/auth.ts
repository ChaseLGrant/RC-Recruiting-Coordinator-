// Authentication primitives (framework-agnostic so they are testable).
// Passwords: scrypt with per-user salt. Sessions: random 256-bit tokens; only
// a SHA-256 hash of the token is stored in the database.

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { Db, newId, nowIso } from "./db";
import { userFromRow, type User } from "./repo";
import type { Role } from "./domain/types";

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

const SESSION_DAYS = 14;

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(db: Db, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.run("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?,?,?,?)", [tokenHash(token), userId, expiresAt.toISOString(), nowIso()]);
  return { token, expiresAt };
}

export async function userForSession(db: Db, token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const row = await db.get(
    "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?",
    [tokenHash(token), nowIso()],
  );
  return row ? userFromRow(row) : null;
}

export async function destroySession(db: Db, token: string | undefined) {
  if (token) await db.run("DELETE FROM sessions WHERE id = ?", [tokenHash(token)]);
}

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

export class LockedOutError extends Error {
  constructor() {
    super(`Too many failed sign-in attempts. For your program's security, this account is locked for ${LOCKOUT_MINUTES} minutes.`);
    this.name = "LockedOutError";
  }
}

/** Verifies credentials with brute-force protection: 5 failures in 15 minutes locks the account temporarily. */
export async function authenticate(db: Db, email: string, password: string): Promise<User | null> {
  const key = email.trim().toLowerCase();
  const since = new Date(Date.now() - LOCKOUT_MINUTES * 60_000).toISOString();
  const recent = await db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM login_attempts WHERE email = ? AND success = 0 AND created_at > ? AND created_at > COALESCE((SELECT MAX(created_at) FROM login_attempts WHERE email = ? AND success = 1), '')",
    [key, since, key],
  );
  if (Number(recent?.n ?? 0) >= MAX_FAILED_LOGINS) throw new LockedOutError();
  const row = await db.get<Record<string, unknown>>("SELECT * FROM users WHERE LOWER(email) = ?", [key]);
  // Always run scrypt so response time doesn't reveal whether an account exists.
  const ok = row ? verifyPassword(password, String(row.password_hash)) : (verifyPassword(password, DUMMY_HASH), false);
  await db.run("INSERT INTO login_attempts (id, email, success, created_at) VALUES (?,?,?,?)", [newId(), key, ok ? 1 : 0, nowIso()]);
  return ok && row ? userFromRow(row) : null;
}

const DUMMY_HASH = hashPassword("rc-timing-equalizer");

export async function createUser(db: Db, orgId: string, u: { email: string; name: string; title?: string | null; role: Role; password: string }): Promise<string> {
  if (u.password.length < 8) throw new Error("Password must be at least 8 characters.");
  const email = u.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Enter a valid email address.");
  if (await db.get("SELECT id FROM users WHERE LOWER(email) = ?", [email])) throw new Error("An account with that email already exists.");
  const id = newId();
  await db.run("INSERT INTO users (id, org_id, email, name, title, role, password_hash, created_at) VALUES (?,?,?,?,?,?,?,?)", [
    id, orgId, email, u.name.trim(), u.title ?? null, u.role, hashPassword(u.password), nowIso(),
  ]);
  return id;
}

// ---------- shared staff login ----------
// One email + password for the whole staff. After signing in, each person
// picks their name ("Who's using RC?") so notes and contacts are attributed.

export interface SessionInfo {
  login: User; // the account that signed in (may be the shared staff login)
  acting: User | null; // the staff member using it (same as login for personal accounts)
}

export async function sessionInfo(db: Db, token: string | undefined): Promise<SessionInfo | null> {
  if (!token) return null;
  const s = await db.get<{ user_id: string; acting_user_id: string | null }>("SELECT user_id, acting_user_id FROM sessions WHERE id = ? AND expires_at > ?", [tokenHash(token), nowIso()]);
  if (!s) return null;
  const loginRow = await db.get("SELECT * FROM users WHERE id = ?", [s.user_id]);
  if (!loginRow) return null;
  const login = userFromRow(loginRow);
  if (!login.isShared) return { login, acting: login };
  if (!s.acting_user_id) return { login, acting: null };
  const actingRow = await db.get("SELECT * FROM users WHERE id = ? AND org_id = ? AND is_shared = 0", [s.acting_user_id, login.orgId]);
  return { login, acting: actingRow ? userFromRow(actingRow) : null };
}

export async function setActingUser(db: Db, token: string, staffUserId: string) {
  const info = await sessionInfo(db, token);
  if (!info?.login.isShared) throw new Error("Not a shared staff login");
  const staff = await db.get("SELECT id FROM users WHERE id = ? AND org_id = ? AND is_shared = 0", [staffUserId, info.login.orgId]);
  if (!staff) throw new Error("Pick someone from your staff");
  await db.run("UPDATE sessions SET acting_user_id = ? WHERE id = ?", [staffUserId, tokenHash(token)]);
}

export async function clearActingUser(db: Db, token: string) {
  await db.run("UPDATE sessions SET acting_user_id = NULL WHERE id = ?", [tokenHash(token)]);
}

/** Creates or updates the program's shared staff login. */
export async function setSharedLogin(db: Db, orgId: string, email: string, password: string, teamName: string): Promise<string> {
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");
  const e = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error("Enter a valid email address.");
  const existing = await db.get<{ id: string; org_id: string }>("SELECT id, org_id FROM users WHERE LOWER(email) = ?", [e]);
  if (existing && existing.org_id !== orgId) throw new Error("That email is already used by another account.");
  const shared = await db.get<{ id: string }>("SELECT id FROM users WHERE org_id = ? AND is_shared = 1", [orgId]);
  if (shared) {
    if (existing && existing.id !== shared.id) throw new Error("That email belongs to a staff member's personal login.");
    await db.run("UPDATE users SET email = ?, password_hash = ?, name = ? WHERE id = ?", [e, hashPassword(password), `${teamName} staff`, shared.id]);
    return shared.id;
  }
  if (existing) throw new Error("That email belongs to a staff member's personal login.");
  const id = newId();
  await db.run("INSERT INTO users (id, org_id, email, name, title, role, password_hash, is_shared, created_at) VALUES (?,?,?,?,?,?,?,1,?)", [
    id, orgId, e, `${teamName} staff`, "Shared staff login", "viewer", hashPassword(password), nowIso(),
  ]);
  return id;
}

/** Adds a staff member who signs in through the shared login (no personal password). */
export async function addStaffProfile(db: Db, orgId: string, s: { name: string; title?: string | null; role: Role }): Promise<string> {
  if (!s.name.trim()) throw new Error("Enter the coach's name.");
  const id = newId();
  // Unique placeholder address; profiles can't sign in on their own (empty password hash never verifies).
  await db.run("INSERT INTO users (id, org_id, email, name, title, role, password_hash, is_shared, created_at) VALUES (?,?,?,?,?,?,?,0,?)", [
    id, orgId, `profile-${id}@staff.rc.local`, s.name.trim(), s.title?.trim() || null, s.role, "", nowIso(),
  ]);
  return id;
}
