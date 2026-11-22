// Reaching every program: the RC owner uploads a list of schools (name, ZIP,
// colors, logo, coach). Each school gets a personal preview link. Tapping it
// opens RC already wearing that school's name and colors, with fictional
// sample players near their campus — no sign-up. RC records each open so the
// owner knows who's interested, and one tap turns the preview into the
// school's real account (free trial, no card).

import { randomBytes } from "node:crypto";
import type { Db } from "../db";
import { newId, nowIso } from "../db";
import { geocode } from "../domain/geo";
import { sanitizeBranding, type Branding } from "../repo";
import { parseCsv } from "../providers/csv";
import { createGuestDemo } from "../onboarding";
import { createInvite, createSchool } from "../billing/schools";

export interface Prospect {
  id: string;
  slug: string;
  programName: string;
  teamName: string | null;
  campusZip: string;
  branding: Branding;
  coachName: string | null;
  coachEmail: string | null;
  conference: string | null;
  orgId: string | null;
  visits: number;
  lastVisitAt: string | null;
  opens: number;
  firstOpenedAt: string | null;
  lastOpenedAt: string | null;
  createdAt: string;
}

const fromRow = (r: Record<string, unknown>): Prospect => ({
  id: String(r.id), slug: String(r.slug), programName: String(r.program_name), teamName: (r.team_name as string) ?? null,
  campusZip: String(r.campus_zip), branding: sanitizeBranding(JSON.parse(String(r.branding_json || "{}"))),
  coachName: (r.coach_name as string) ?? null, coachEmail: (r.coach_email as string) ?? null, conference: (r.conference as string) ?? null,
  orgId: (r.org_id as string) ?? null, visits: Number(r.visits ?? 0), lastVisitAt: (r.last_visit_at as string) ?? null, opens: Number(r.opens ?? 0), firstOpenedAt: (r.first_opened_at as string) ?? null,
  lastOpenedAt: (r.last_opened_at as string) ?? null, createdAt: String(r.created_at),
});

const slugify = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "program";

export async function listProspects(db: Db): Promise<Prospect[]> {
  return (await db.all<Record<string, unknown>>("SELECT * FROM prospects ORDER BY (last_opened_at IS NULL), last_opened_at DESC, program_name")).map(fromRow);
}

export async function getProspectBySlug(db: Db, slug: string): Promise<Prospect | null> {
  const r = await db.get<Record<string, unknown>>("SELECT * FROM prospects WHERE slug = ?", [slug]);
  return r ? fromRow(r) : null;
}

// ---------- the school list ----------

const COLS: Record<string, string[]> = {
  program: ["program", "program name", "school", "college", "school name", "name", "institution"],
  team: ["team", "team name", "header", "short name", "nickname", "mascot"],
  zip: ["zip", "zip code", "campus zip", "postal code"],
  primary: ["primary", "primary color", "main color", "color 1", "color"],
  ink: ["secondary", "secondary color", "dark", "header color", "color 2", "ink"],
  accent: ["accent", "accent color", "color 3", "tertiary"],
  logo: ["logo", "logo url", "logo link", "logo_url"],
  coach: ["coach", "head coach", "coach name", "contact", "contact name"],
  email: ["email", "coach email", "contact email", "e-mail"],
  conference: ["conference", "conf", "league", "division"],
};

function hex(v: string): string | undefined {
  const s = v.trim().replace(/^#?/, "#");
  return /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : /^#[0-9a-f]{3}$/i.test(s) ? "#" + s.slice(1).split("").map((c) => c + c).join("").toLowerCase() : undefined;
}

/** Downloads a logo from a link (PNG, JPG, WebP or SVG, under 500 KB). Returns null if it can't. */
export async function fetchLogo(url: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (!/^https:\/\//i.test(url.trim())) return null;
  try {
    const res = await fetchImpl(url.trim(), { signal: AbortSignal.timeout(8000), redirect: "follow" });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 500_000) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

export interface ProspectImportResult { added: number; updated: number; logos: number; problems: string[] }

/** Adds or updates schools from a CSV. Re-uploading the same school (same name) updates it and keeps its link. */
export async function importProspects(db: Db, csvText: string, opts: { fetchImpl?: typeof fetch } = {}): Promise<ProspectImportResult> {
  const rows = parseCsv(csvText.replace(/^﻿/, "")).filter((r) => r.some((c) => c.trim()));
  if (rows.length < 2) throw new Error("The list needs a header row and at least one school.");
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (k: string) => head.findIndex((h) => COLS[k].includes(h));
  const idx = Object.fromEntries(Object.keys(COLS).map((k) => [k, col(k)]));
  if (idx.program < 0 || idx.zip < 0) throw new Error('The list needs a "Program" (school name) column and a "ZIP" column.');
  const out: ProspectImportResult = { added: 0, updated: 0, logos: 0, problems: [] };
  const get = (r: string[], k: string) => (idx[k] >= 0 ? (r[idx[k]] ?? "").trim() : "");
  for (const [n, r] of rows.slice(1).entries()) {
    const program = get(r, "program");
    const zip = get(r, "zip").replace(/^(\d{4})$/, "0$1");
    if (!program) continue;
    if (!geocode(zip)) { out.problems.push(`Row ${n + 2} (${program}): couldn't find ZIP "${zip}".`); continue; }
    const existing = await db.get<{ id: string; branding_json: string }>("SELECT id, branding_json FROM prospects WHERE lower(program_name) = lower(?)", [program]);
    const before = existing ? sanitizeBranding(JSON.parse(existing.branding_json)) : null;
    const logoUrl = get(r, "logo");
    const logo = logoUrl ? await fetchLogo(logoUrl, opts.fetchImpl) : null;
    if (logoUrl && !logo) out.problems.push(`Row ${n + 2} (${program}): couldn't download the logo, so the preview shows the team's initial instead.`);
    if (logo) out.logos++;
    const branding = sanitizeBranding({
      teamName: get(r, "team") || null,
      primary: hex(get(r, "primary")) ?? before?.primary,
      ink: hex(get(r, "ink")) ?? before?.ink,
      accent: hex(get(r, "accent")) ?? before?.accent,
      logoDataUrl: logo ?? before?.logoDataUrl ?? null,
    });
    const fields = [program, get(r, "team") || null, zip, JSON.stringify(branding), get(r, "coach") || null, get(r, "email") || null, get(r, "conference") || null];
    if (existing) {
      await db.run("UPDATE prospects SET program_name = ?, team_name = ?, campus_zip = ?, branding_json = ?, coach_name = ?, coach_email = ?, conference = ? WHERE id = ?", [...fields, existing.id]);
      out.updated++;
    } else {
      // Readable but not guessable, so one school can't stumble onto another's link list.
      const slug = `${slugify(get(r, "team") || program)}-${randomBytes(3).toString("hex")}`;
      await db.run("INSERT INTO prospects (id, slug, program_name, team_name, campus_zip, branding_json, coach_name, coach_email, conference, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)", [newId(), slug, ...fields, nowIso()]);
      out.added++;
    }
  }
  return out;
}

// ---------- the preview ----------

/** Someone loaded the school's welcome page (may be a coach, or an email virus-scanner). */
export async function recordVisit(db: Db, prospectId: string): Promise<void> {
  await db.run("UPDATE prospects SET visits = visits + 1, last_visit_at = ? WHERE id = ?", [nowIso(), prospectId]);
}

/** Called on each page view inside a demo, so the owner can see how much a school explored. */
export async function trackDemoView(db: Db, orgId: string): Promise<void> {
  await db.run("UPDATE prospect_demos SET views = views + 1, last_seen_at = ? WHERE org_id = ?", [nowIso(), orgId]);
}

export type Stage = "not_opened" | "clicked" | "tried" | "explored" | "signed_up" | "using";
export const STAGE_LABEL: Record<Stage, string> = {
  not_opened: "Not opened", clicked: "Clicked link", tried: "Opened demo", explored: "Explored demo", signed_up: "Signed up", using: "Using RC",
};

export interface ProspectStatus { stage: Stage; demoViews: number; demoLastSeen: string | null; players: number; staff: number; lastActive: string | null }

/** Where each school is, from first click to everyday use. */
export async function prospectStatuses(db: Db, prospects: Prospect[]): Promise<Map<string, ProspectStatus>> {
  const out = new Map<string, ProspectStatus>();
  for (const p of prospects) {
    const d = await db.get<{ views: number; seen: string | null }>("SELECT COALESCE(SUM(views),0) AS views, MAX(last_seen_at) AS seen FROM prospect_demos WHERE prospect_id = ?", [p.id]);
    const demoViews = Number(d?.views ?? 0);
    let players = 0, staff = 0, lastActive: string | null = null;
    if (p.orgId) {
      const u = await db.get<{ players: number; staff: number; active: string | null }>(
        `SELECT (SELECT COUNT(*) FROM follows WHERE org_id = ?) AS players,
                (SELECT COUNT(*) FROM users WHERE org_id = ? AND is_shared = 0) AS staff,
                (SELECT MAX(s.created_at) FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.org_id = ?) AS active`,
        [p.orgId, p.orgId, p.orgId],
      );
      players = Number(u?.players ?? 0); staff = Number(u?.staff ?? 0); lastActive = u?.active ?? null;
    }
    const stage: Stage = p.orgId && staff > 0 ? (players >= 5 ? "using" : "signed_up") : demoViews >= 5 ? "explored" : p.opens > 0 ? "tried" : p.visits > 0 ? "clicked" : "not_opened";
    out.set(p.id, { stage, demoViews, demoLastSeen: d?.seen ?? null, players, staff, lastActive });
  }
  return out;
}

const PREVIEWS_PER_SCHOOL_PER_DAY = () => Math.max(1, Number(process.env.RC_PREVIEWS_PER_SCHOOL_PER_DAY ?? 25));

/** Opens a fresh branded demo for a school's preview link and records the open. */
export async function openPreview(db: Db, slug: string): Promise<{ userId: string; orgId: string }> {
  const p = await getProspectBySlug(db, slug);
  if (!p) throw new Error("That preview link isn't valid.");
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const today = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM prospect_demos WHERE prospect_id = ? AND created_at >= ?", [p.id, since]);
  if (Number(today?.n ?? 0) >= PREVIEWS_PER_SCHOOL_PER_DAY()) throw new Error("This preview has been opened a lot today. Try again tomorrow, or reply to the email and we'll set you up directly.");
  const demo = await createGuestDemo(db, { programName: p.programName, teamName: p.teamName ?? p.branding.teamName, campusZip: p.campusZip, branding: p.branding });
  const now = nowIso();
  await db.run("INSERT INTO prospect_demos (org_id, prospect_id, created_at) VALUES (?,?,?)", [demo.orgId, p.id, now]);
  await db.run("UPDATE prospects SET opens = opens + 1, first_opened_at = COALESCE(first_opened_at, ?), last_opened_at = ? WHERE id = ?", [now, now, p.id]);
  return demo;
}

export async function prospectForDemo(db: Db, orgId: string): Promise<Prospect | null> {
  const r = await db.get<Record<string, unknown>>("SELECT p.* FROM prospects p JOIN prospect_demos d ON d.prospect_id = p.id WHERE d.org_id = ?", [orgId]);
  return r ? fromRow(r) : null;
}

/** "Set this up for real": creates the school's account (once) and returns a one-time setup link token. */
export async function startFromPreview(db: Db, slug: string): Promise<string> {
  const p = await getProspectBySlug(db, slug);
  if (!p) throw new Error("That link isn't valid.");
  let orgId = p.orgId;
  if (!orgId) {
    orgId = await createSchool(db, { programName: p.programName, teamName: p.teamName ?? p.branding.teamName, campusZip: p.campusZip, branding: p.branding });
    await db.run("UPDATE prospects SET org_id = ? WHERE id = ?", [orgId, p.id]);
  } else {
    const claimed = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE org_id = ?", [orgId]);
    if (Number(claimed?.n ?? 0) > 0) throw new Error(`${p.teamName ?? p.programName} is already set up on RC. Ask your head coach for the staff login, or sign in.`);
  }
  return createInvite(db, orgId, null);
}

// ---------- mail merge ----------

export function mailMergeCsv(prospects: Prospect[], baseUrl: string, statuses?: Map<string, ProspectStatus>): string {
  const cell = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ["School", "Team", "Conference", "Coach", "Coach first name", "Email", "Preview link", "Stage", "Demo opens", "Last opened", "Signed up"];
  const lines = [head.join(",")];
  for (const p of prospects) {
    lines.push([
      p.programName, p.teamName ?? p.branding.teamName ?? "", p.conference ?? "", p.coachName ?? "", (p.coachName ?? "").replace(/^(coach|dr\.?|mr\.?)\s+/i, "").split(/\s+/)[0] ?? "",
      p.coachEmail ?? "", `${baseUrl}/p/${p.slug}`, statuses?.get(p.id) ? STAGE_LABEL[statuses.get(p.id)!.stage] : "", p.opens, p.lastOpenedAt?.slice(0, 10) ?? "", p.orgId ? "yes" : "",
    ].map(cell).join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
