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

export async function authenticate(db: Db, email: string, password: string): Promise<User | null> {
  const row = await db.get<Record<string, unknown>>("SELECT * FROM users WHERE LOWER(email) = LOWER(?)", [email.trim()]);
  if (!row || !verifyPassword(password, String(row.password_hash))) return null;
  return userFromRow(row);
}

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
