// Player page finder. For a player RC knows about, searches the public web
// for their stat pages (MaxPreps, Perfect Game, PBR…), film (Hudl, YouTube)
// and social accounts (X, Instagram). Every result is scored against what RC
// knows (name, school, town, class) and goes to the coach to approve or
// reject. Approved stat pages are then kept updated automatically; rejected
// links are remembered and never suggested again.

import { Db, newId, nowIso } from "../db";
import { safeUrl } from "../domain/urls";
import { normalizeName } from "../domain/identity";
import { addTrackedPage } from "../watch/runner";
import { audit, authorize, getAthlete, logEvent, normalizeXHandle, updateAthleteContact, type AthleteRecord, type Ctx } from "../repo";
import { createApproval } from "../repo/approvals";
import { getSearchProvider, type SearchProvider, type SearchResult } from "./search";
import { orgCanUsePaidServices } from "../billing/plan";

export type LinkKind = "stats" | "social" | "film";

const SITES: Array<{ re: RegExp; site: string; kind: LinkKind; profile: RegExp }> = [
  { re: /(^|\.)maxpreps\.com$/, site: "MaxPreps", kind: "stats", profile: /\/(athletes?|[a-z]{2}\/[^/]+\/[^/]+\/athletes?)\//i },
  { re: /(^|\.)perfectgame\.org$/, site: "Perfect Game", kind: "stats", profile: /playerprofile|players\/|Players\/Playerprofile/i },
  { re: /(^|\.)(prepbaseballreport|prepbaseball)\.com$/, site: "Prep Baseball Report", kind: "stats", profile: /\/profiles?\//i },
  { re: /(^|\.)(baseballnorthwest|fieldlevel|ncsasports|ncsa)\.(com|org)$/, site: "Recruiting profile", kind: "stats", profile: /./ },
  { re: /(^|\.)hudl\.com$/, site: "Hudl", kind: "film", profile: /\/(profile|video)\//i },
  { re: /(^|\.)(youtube\.com|youtu\.be)$/, site: "YouTube", kind: "film", profile: /watch|\/@|\/channel\/|youtu\.be\//i },
  { re: /(^|\.)(x|twitter)\.com$/, site: "X", kind: "social", profile: /^\/@?[A-Za-z0-9_]{1,15}\/?$/ },
  { re: /(^|\.)instagram\.com$/, site: "Instagram", kind: "social", profile: /^\/[A-Za-z0-9_.]{1,30}\/?$/ },
];

export function classifyUrl(raw: string): { site: string; kind: LinkKind } | null {
  const url = safeUrl(raw);
  if (!url) return null;
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, "").replace(/^m\./, "").replace(/^mobile\./, "");
  for (const s of SITES) {
    if (!s.re.test(host)) continue;
    const path = u.pathname + (host === "youtu.be" ? "/" : "");
    if (!s.profile.test(s.kind === "social" ? u.pathname : path)) return null; // search pages, home pages, etc.
    if (s.kind === "social" && /^\/(search|home|explore|i|intent|share|hashtag|settings|login|signup|notifications|messages|accounts|explore|p|reel|reels|stories|tv)\b/i.test(u.pathname)) return null;
    return { site: s.site, kind: s.kind };
  }
  return null;
}

/** How likely a search result is this player's own page (0–1), with reasons. */
export function scoreResult(a: Pick<AthleteRecord, "firstName" | "lastName" | "gradYear" | "highSchool" | "city" | "state" | "primaryPosition">, r: SearchResult): { score: number; reasons: string[] } {
  // Compare whole words (title, snippet, and the URL's slug words), never run-together text.
  const words = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let slug = r.url;
  try { slug = decodeURIComponent(new URL(r.url).pathname); } catch { /* keep raw */ }
  const textWords = new Set([...words(`${r.title} ${r.snippet}`), ...words(slug)]);
  const text = ` ${words(`${r.title} ${r.snippet}`).join(" ")} `;
  const reasons: string[] = [];
  const first = words(a.firstName)[0] ?? "";
  const last = words(a.lastName).join(" ");
  const lastOk = last.split(" ").every((w) => textWords.has(w)) || words(slug).join("").includes((first + last).replace(/ /g, ""));
  if (!lastOk) return { score: 0, reasons: ["Last name not on the page"] };
  let score = 0.35;
  reasons.push("Last name matches");
  if (textWords.has(first) || words(slug).join("").includes(first + last.replace(/ /g, ""))) {
    score += 0.25;
    reasons.push("First name matches");
  } else return { score: 0.15, reasons: ["First name doesn't match"] };
  if (a.gradYear && (text.includes(` ${a.gradYear} `) || text.includes(` ${String(a.gradYear).slice(2)} `))) {
    score += 0.15;
    reasons.push(`Class of ${a.gradYear}`);
  }
  const schoolWords = words((a.highSchool ?? "").replace(/\b(high school|hs|\(fictional\))\b/gi, "")).filter((w) => w.length > 3 && !["high", "school", "academy", "fictional"].includes(w));
  if (schoolWords.length && schoolWords.some((w) => textWords.has(w))) {
    score += 0.15;
    reasons.push("School matches");
  }
  if (a.city && text.includes(` ${words(a.city).join(" ")} `)) {
    score += 0.1;
    reasons.push("Hometown matches");
  }
  if (textWords.has("baseball") || textWords.has("softball")) {
    score += 0.05;
    reasons.push("Baseball page");
  }
  return { score: Math.min(1, score), reasons };
}

/** Name alone isn't enough: at least one of class, school or hometown must also match. */
export const MIN_SCORE = 0.7;

function queriesFor(a: AthleteRecord): string[] {
  const name = `"${a.firstName} ${a.lastName}"`;
  const where = [a.highSchool?.replace(/\s*\(fictional\)/, ""), a.city, a.state].filter(Boolean).join(" ");
  const cls = a.gradYear ? `${a.gradYear}` : "";
  return [
    `${name} baseball ${cls} ${where} (site:maxpreps.com OR site:perfectgame.org OR site:prepbaseballreport.com)`.replace(/\s+/g, " ").trim(),
    `${name} baseball ${cls} ${a.city ?? ""} (site:x.com OR site:twitter.com OR site:instagram.com OR site:hudl.com OR site:youtube.com)`.replace(/\s+/g, " ").trim(),
  ];
}

export interface FindResult {
  searched: boolean;
  candidates: number;
  provider: string | null;
  note?: string;
}

/** Searches for one player's pages and queues what it finds for coach review. */
export async function findPlayerPages(db: Db, orgId: string, athleteId: string, opts: { provider?: SearchProvider | null; runId?: string | null } = {}): Promise<FindResult> {
  const provider = opts.provider === undefined ? getSearchProvider() : opts.provider;
  if (!provider) return { searched: false, candidates: 0, provider: null, note: "No search service connected (Settings → Player page finder)." };
  const a = await getAthlete(db, orgId, athleteId);
  if (!a) return { searched: false, candidates: 0, provider: provider.name, note: "Player not found" };
  if (a.optedOut) return { searched: false, candidates: 0, provider: provider.name, note: "Player opted out" };

  const known = new Set(
    (await db.all<{ url: string }>(
      "SELECT url FROM link_candidates WHERE org_id = ? AND athlete_id = ? UNION SELECT url FROM athlete_links WHERE org_id = ? AND athlete_id = ? UNION SELECT url FROM tracked_pages WHERE org_id = ? AND athlete_id = ?",
      [orgId, athleteId, orgId, athleteId, orgId, athleteId],
    )).map((r) => r.url),
  );
  const fresh: Array<{ id: string; url: string; site: string; kind: LinkKind; score: number }> = [];
  for (const q of queriesFor(a)) {
    let results: SearchResult[];
    try {
      results = await provider.search(q);
    } catch (e) {
      return { searched: true, candidates: fresh.length, provider: provider.name, note: e instanceof Error ? e.message : String(e) };
    }
    for (const r of results) {
      const url = safeUrl(r.url);
      const cls = url ? classifyUrl(url) : null;
      if (!url || !cls || known.has(url)) continue;
      const { score, reasons } = scoreResult(a, r);
      if (score < MIN_SCORE) continue;
      known.add(url);
      const id = newId();
      await db.run(
        "INSERT INTO link_candidates (id, org_id, athlete_id, url, kind, site, title, snippet, score, reasons, status, found_at) VALUES (?,?,?,?,?,?,?,?,?,?,'pending',?) ON CONFLICT (org_id, athlete_id, url) DO NOTHING",
        [id, orgId, athleteId, url, cls.kind, cls.site, r.title.slice(0, 200), r.snippet.slice(0, 400), score, reasons.join(", "), nowIso()],
      );
      fresh.push({ id, url, site: cls.site, kind: cls.kind, score });
    }
  }
  if (!fresh.length) {
    await logEvent(db, orgId, { type: "athlete_researched", message: `Searched the web for ${a.firstName} ${a.lastName}: no new pages found`, athleteId, runId: opts.runId });
  }
  if (fresh.length) {
    const name = `${a.firstName} ${a.lastName}`;
    await createApproval(db, orgId, {
      kind: "links_found",
      title: `${fresh.length} page${fresh.length > 1 ? "s" : ""} found for ${name}`,
      summary: `RC searched the public web and found ${fresh.map((f) => f.site).join(", ")}. Keep the ones that are really him; approved stat pages update automatically.`,
      payload: { candidateIds: fresh.map((f) => f.id) },
      dedupeKey: `links:${athleteId}:${fresh.map((f) => f.id).join(",")}`,
      athleteId,
      runId: opts.runId,
    });
    await logEvent(db, orgId, { type: "athlete_researched", message: `Found ${fresh.length} possible page${fresh.length > 1 ? "s" : ""} for ${name} (${[...new Set(fresh.map((f) => f.site))].join(", ")})`, athleteId, runId: opts.runId });
  }
  return { searched: true, candidates: fresh.length, provider: provider.name };
}

export interface CandidateRow {
  id: string; athlete_id: string; url: string; kind: LinkKind; site: string; title: string | null; snippet: string | null; score: number; reasons: string | null; status: string; found_at: string;
}

export async function listCandidates(db: Db, orgId: string, opts: { athleteId?: string; ids?: string[]; status?: string } = {}): Promise<CandidateRow[]> {
  const where = ["org_id = ?"];
  const params: (string | number)[] = [orgId];
  if (opts.athleteId) { where.push("athlete_id = ?"); params.push(opts.athleteId); }
  if (opts.status) { where.push("status = ?"); params.push(opts.status); }
  if (opts.ids) {
    if (!opts.ids.length) return [];
    where.push(`id IN (${opts.ids.map(() => "?").join(",")})`);
    params.push(...opts.ids);
  }
  return db.all<CandidateRow>(`SELECT * FROM link_candidates WHERE ${where.join(" AND ")} ORDER BY score DESC`, params);
}

/** Coach decision on found links: accepted stat pages become tracked; socials and film are saved. */
export async function decideCandidates(ctx: Ctx, accept: string[], reject: string[]): Promise<{ accepted: number; rejected: number }> {
  authorize(ctx, "decide_approvals");
  let accepted = 0;
  for (const c of await listCandidates(ctx.db, ctx.orgId, { ids: accept })) {
    if (c.status !== "pending") continue;
    if (c.kind === "stats") await addTrackedPage(ctx, c.athlete_id, c.url);
    else {
      await ctx.db.run("INSERT INTO athlete_links (id, org_id, athlete_id, url, kind, site, added_by, created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (org_id, athlete_id, url) DO NOTHING", [
        newId(), ctx.orgId, c.athlete_id, c.url, c.kind, c.site, ctx.userId, nowIso(),
      ]);
      if (c.site === "X") {
        const a = await getAthlete(ctx.db, ctx.orgId, c.athlete_id);
        if (a && !a.xHandle) await updateAthleteContact(ctx, c.athlete_id, { xHandle: normalizeXHandle(c.url) });
      }
    }
    await ctx.db.run("UPDATE link_candidates SET status = 'approved', decided_by = ? WHERE id = ?", [ctx.userId, c.id]);
    accepted++;
  }
  let rejected = 0;
  for (const c of await listCandidates(ctx.db, ctx.orgId, { ids: reject })) {
    if (c.status !== "pending") continue;
    await ctx.db.run("UPDATE link_candidates SET status = 'rejected', decided_by = ? WHERE id = ?", [ctx.userId, c.id]);
    rejected++;
  }
  await audit(ctx, "decide_links", "link_candidates", null, { accepted, rejected });
  return { accepted, rejected };
}

export async function listLinks(db: Db, orgId: string, athleteId: string) {
  return db.all<{ id: string; url: string; kind: LinkKind; site: string; created_at: string }>("SELECT * FROM athlete_links WHERE org_id = ? AND athlete_id = ? ORDER BY kind, site", [orgId, athleteId]);
}

/** Players who still need a search: newest first, never searched or searched > 30 days ago. */
export async function playersNeedingSearch(db: Db, orgId: string, athleteIds: string[], limit: number): Promise<string[]> {
  if (!athleteIds.length) return [];
  const searched = new Set((await db.all<{ athlete_id: string }>(
    `SELECT DISTINCT athlete_id FROM link_candidates WHERE org_id = ? AND found_at > ? UNION SELECT DISTINCT athlete_id FROM tracked_pages WHERE org_id = ?`,
    [orgId, new Date(Date.now() - 30 * 86_400_000).toISOString(), orgId],
  )).map((r) => r.athlete_id));
  const tried = new Set((await db.all<{ athlete_id: string }>("SELECT DISTINCT athlete_id FROM events WHERE org_id = ? AND type = 'athlete_researched' AND (message LIKE 'Searched the web for %' OR message LIKE 'Found % possible page%') AND created_at > ?", [orgId, new Date(Date.now() - 30 * 86_400_000).toISOString()])).map((r) => r.athlete_id));
  return athleteIds.filter((id) => !searched.has(id) && !tried.has(id)).slice(0, limit);
}

/** Background batch: searches pages for followed and newly matched players, a few per run. */
export async function runFinderBatch(db: Db, perOrg = Number(process.env.RC_FINDER_PER_RUN ?? 8), deadline = Date.now() + 30_000) {
  const provider = getSearchProvider();
  if (!provider) return [];
  const orgs = await db.all<{ org_id: string }>("SELECT DISTINCT org_id FROM follows UNION SELECT DISTINCT org_id FROM mission_matches WHERE eligible = 1");
  const out = [];
  for (const { org_id } of orgs) {
    if (Date.now() > deadline) break;
    if (!(await orgCanUsePaidServices(db, org_id))) continue;
    const ids = (await db.all<{ athlete_id: string }>(
      "SELECT athlete_id FROM follows WHERE org_id = ? UNION SELECT athlete_id FROM mission_matches WHERE org_id = ? AND eligible = 1",
      [org_id, org_id],
    )).map((r) => r.athlete_id);
    const todo = await playersNeedingSearch(db, org_id, ids, perOrg);
    let found = 0;
    for (const id of todo) {
      if (Date.now() > deadline) break;
      const r = await findPlayerPages(db, org_id, id, { provider });
      found += r.candidates;
      if (r.note?.includes("limit")) break; // daily quota reached
    }
    out.push({ orgId: org_id, searched: todo.length, found });
  }
  return out;
}
