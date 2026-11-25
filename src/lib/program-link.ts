// Each real program gets its own branded staff sign-in page: /p/<slug>
// (e.g. /p/palomar-baseball), in its colors with its logo. School preview
// links from outreach also live under /p/; program slugs never take one of
// those. Later, school.<domain> can map to the same page (see README).

import type { Db } from "./db";
import { authorize, getOrg, orgFromRow, type Ctx, type Org } from "./repo";

const RESERVED = new Set(["login", "signup", "demo", "admin", "api", "app", "www", "rc", "help", "support", "pricing", "welcome", "join", "who"]);

export function slugify(s: string): string {
  return s.toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
}

export function validSlug(s: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(s) && !RESERVED.has(s) && !s.includes("--");
}

async function taken(db: Db, slug: string, exceptOrgId?: string): Promise<boolean> {
  const org = await db.get<{ id: string }>("SELECT id FROM orgs WHERE slug = ?", [slug]);
  if (org && org.id !== exceptOrgId) return true;
  return Boolean(await db.get("SELECT 1 AS x FROM prospects WHERE slug = ?", [slug]));
}

/** The program's sign-in slug, created from its team name the first time it's needed. Demos get none. */
export async function ensureProgramSlug(db: Db, org: Org): Promise<string | null> {
  if (org.isDemo) return null;
  if (org.slug) return org.slug;
  const base = slugify(org.settings.branding.teamName ?? org.settings.programDisplayName ?? org.name) || "program";
  let slug = validSlug(base) ? base : `${base || "program"}-rc`.replace(/^-/, "");
  for (let i = 2; (await taken(db, slug, org.id)) || !validSlug(slug); i++) slug = `${base.slice(0, 36)}-${i}`;
  await db.run("UPDATE orgs SET slug = ? WHERE id = ? AND slug IS NULL", [slug, org.id]);
  return (await getOrg(db, org.id)).slug;
}

/** Head coach picks the sign-in link. Throws a coach-readable message. */
export async function setProgramSlug(ctx: Ctx, raw: string): Promise<string> {
  authorize(ctx, "manage_settings");
  const slug = slugify(raw);
  if (!validSlug(slug)) throw new Error("Use 3–40 letters, numbers or dashes, like palomar-baseball.");
  if (await taken(ctx.db, slug, ctx.orgId)) throw new Error(`"${slug}" is already taken. Try adding your sport or city.`);
  await ctx.db.run("UPDATE orgs SET slug = ? WHERE id = ?", [slug, ctx.orgId]);
  return slug;
}

export async function getOrgBySlug(db: Db, slug: string): Promise<Org | null> {
  if (!slug || slug.length > 60) return null;
  const r = await db.get("SELECT * FROM orgs WHERE slug = ? AND is_demo = 0", [slug.toLowerCase()]);
  return r ? orgFromRow(r) : null;
}
