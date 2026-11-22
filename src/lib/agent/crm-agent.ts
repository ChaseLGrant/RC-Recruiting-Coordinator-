// RC research agent: keeps each player on a coach's board current.
// For one player it searches the public web (Claude + the web search tool),
// confirms it has the right kid, and returns proposed updates — new stats,
// commitments, school/team changes, upcoming games, film, socials, news —
// each with the page it came from and a short quote. RC then validates every
// update in code (the cited page must be one the search actually returned,
// stats must be plausible, sensitive topics are dropped) and queues the
// survivors for the coach to approve or skip. Nothing is changed silently.

import Anthropic from "@anthropic-ai/sdk";
import { Db, newId, nowIso } from "../db";
import { metricDef, METRICS } from "../domain/metrics";
import { safeUrl } from "../domain/urls";
import { validFor } from "../watch/extract";
import { getAthlete, getOrg, listObservations, logEvent, type AthleteRecord } from "../repo";
import { resolveAll } from "../domain/provenance";
import { createApproval } from "../repo/approvals";
import { aiAccess } from "./entitlement";

export const AGENT_MODEL = process.env.RC_AGENT_MODEL ?? "claude-opus-5-5";
const MAX_SEARCHES = 6;

/** Minimal client surface so tests can inject a fake. */
export interface AgentClient {
  beta: { messages: { create(params: Anthropic.Beta.MessageCreateParamsNonStreaming): Promise<Anthropic.Beta.BetaMessage> } };
}

export function getAgentClient(env: Record<string, string | undefined> = process.env): AgentClient | null {
  if (!env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN) return null;
  return new Anthropic() as unknown as AgentClient;
}

export type UpdateType = "commitment" | "stat" | "game" | "film" | "social" | "school_change" | "team_change" | "news" | "contact";

export interface ProposedUpdate {
  id: string;
  type: UpdateType;
  summary: string;
  details: Record<string, unknown>;
  sourceUrl: string;
  sourceTitle: string | null;
  quote: string;
}

const SEASON_KEYS = Object.keys(METRICS);

const SYSTEM = `You are a research assistant for a college baseball coaching staff. You keep one recruit's profile in their recruiting board current using public web pages.

Rules:
- Research only the specific player described. First confirm identity using school, class year, hometown, team or position. If you cannot confirm it is the same person, say so and propose no updates.
- Only report facts that are stated on a page you found with web search in this session. For each update give the page URL exactly as it appeared in your search results and a short verbatim quote (under 200 characters) from that page that shows the fact.
- Only report things that are new or different from what the coach already has (provided below). Prefer official sources: school and team sites, MaxPreps, Perfect Game, Prep Baseball Report, the player's own public accounts, local news.
- Never report health, injury or medical information; grades, GPA or test scores; family or financial details; or anything about other minors.
- Contact details only if the player (or his family) published them himself for recruiting on his own public profile.
- Do not guess, estimate or round numbers. If a number is unclear, leave it out.

Reply with only a JSON object in a \`\`\`json code fence, in this shape:
{
  "identity": { "confident": true|false, "reason": "how you confirmed it, or why you could not" },
  "updates": [
    { "type": "commitment", "summary": "...", "details": { "status": "committed"|"decommitted", "college": "...", "date": "YYYY-MM-DD or null" }, "sourceUrl": "...", "sourceTitle": "...", "quote": "..." },
    { "type": "stat", "summary": "...", "details": { "key": one of ${JSON.stringify(SEASON_KEYS)}, "value": number, "season": "2026 or null", "asOf": "YYYY-MM-DD or null" }, "sourceUrl": "...", "sourceTitle": "...", "quote": "..." },
    { "type": "game", "summary": "...", "details": { "date": "YYYY-MM-DD", "time": "4:00 PM or null", "opponent": "...", "location": "... or null" }, "sourceUrl": "...", "sourceTitle": "...", "quote": "..." },
    { "type": "film" | "social", "summary": "...", "details": { "url": "...", "site": "Hudl|YouTube|X|Instagram|..." }, "sourceUrl": "...", "sourceTitle": "...", "quote": "..." },
    { "type": "school_change", "details": { "highSchool": "..." }, ... },
    { "type": "team_change", "details": { "team": "..." }, ... },
    { "type": "news", "details": { "headline": "..." }, ... },
    { "type": "contact", "details": { "email": "... or null", "phone": "... or null" }, ... }
  ]
}
Return "updates": [] if nothing new is found.`;

const SENSITIVE = /\b(injur|surgery|torn|tear\b|concussion|medical|diagnos|rehab|illness|hospital|gpa|grades?\b|sat\b|act\b|transcript|arrest|suspend|divorce|income)/i;

function knownProfile(a: AthleteRecord, metrics: ReturnType<typeof resolveAll>, links: string[], lastRun: string | null) {
  return {
    name: `${a.firstName} ${a.lastName}`,
    classYear: a.gradYear,
    positions: [a.primaryPosition, a.secondaryPosition].filter(Boolean),
    highSchool: a.highSchool,
    travelTeam: a.team,
    hometown: [a.city, a.state].filter(Boolean).join(", ") || null,
    commitment: a.commitmentStatus,
    knownNumbers: Object.fromEntries(Array.from(metrics.values()).filter((m) => !metricDef(m.key).sensitive).map((m) => [m.key, { value: m.primary.value, asOf: m.primary.measuredAt?.slice(0, 10) ?? null }])),
    knownLinks: links,
    lastResearched: lastRun,
  };
}

function parseJsonBlock(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Deterministic checks on what the model proposed. Returns only updates RC can stand behind. */
export function validateUpdates(raw: unknown, searchedUrls: Set<string>, a: AthleteRecord, current: { metrics: Map<string, number>; links: Set<string> }): { updates: ProposedUpdate[]; dropped: string[]; identity: { confident: boolean; reason: string } } {
  const dropped: string[] = [];
  const obj = (raw ?? {}) as { identity?: { confident?: boolean; reason?: string }; updates?: unknown[] };
  const identity = { confident: Boolean(obj.identity?.confident), reason: String(obj.identity?.reason ?? "No identity check returned") };
  if (!identity.confident) return { updates: [], dropped: ["Identity not confirmed"], identity };
  const norm = (u: string) => u.replace(/#.*$/, "").replace(/\/$/, "").toLowerCase();
  const searched = new Set([...searchedUrls].map(norm));
  const out: ProposedUpdate[] = [];
  for (const item of Array.isArray(obj.updates) ? obj.updates : []) {
    const u = item as { type?: string; summary?: string; details?: Record<string, unknown>; sourceUrl?: string; sourceTitle?: string; quote?: string };
    const type = u.type as UpdateType;
    const src = safeUrl(u.sourceUrl ?? "");
    const quote = String(u.quote ?? "").trim().slice(0, 300);
    const details = (u.details ?? {}) as Record<string, unknown>;
    const why = (r: string) => dropped.push(`${type ?? "?"}: ${r}`);
    if (!["commitment", "stat", "game", "film", "social", "school_change", "team_change", "news", "contact"].includes(type)) { why("unknown type"); continue; }
    if (!src || !searched.has(norm(src))) { why("source isn't a page from this search"); continue; }
    if (!quote) { why("no quote from the source"); continue; }
    if (SENSITIVE.test(`${u.summary ?? ""} ${quote} ${JSON.stringify(details)}`)) { why("sensitive topic"); continue; }
    let summary = String(u.summary ?? "").slice(0, 200);
    if (type === "stat") {
      const key = String(details.key ?? "");
      const value = Number(details.value);
      if (!SEASON_KEYS.includes(key) || metricDef(key).sensitive) { why(`unsupported stat ${key}`); continue; }
      if (!Number.isFinite(value) || (METRICS[key].season ? !validFor(key, value) : value <= 0)) { why(`implausible ${key} ${details.value}`); continue; }
      if (current.metrics.get(key) === value) { why(`${key} unchanged`); continue; }
      summary = summary || `${metricDef(key).label}: ${metricDef(key).format(value)}`;
    }
    if (type === "commitment") {
      if (!["committed", "decommitted"].includes(String(details.status)) || !String(details.college ?? "").trim()) { why("commitment without a status or college"); continue; }
      if (a.commitmentStatus === "committed" && details.status === "committed") { why("already committed on record"); continue; }
    }
    if (type === "game" && (!/^\d{4}-\d{2}-\d{2}$/.test(String(details.date ?? "")) || !String(details.opponent ?? "").trim() || String(details.date) < nowIso().slice(0, 10))) { why("game missing a future date or opponent"); continue; }
    if (type === "film" || type === "social") {
      const url = safeUrl(String(details.url ?? ""));
      if (!url) { why("bad link"); continue; }
      if (current.links.has(norm(url))) { why("link already saved"); continue; }
      details.url = url;
    }
    if (type === "school_change" && !String(details.highSchool ?? "").trim()) { why("no school"); continue; }
    if (type === "team_change" && !String(details.team ?? "").trim()) { why("no team"); continue; }
    if (type === "news" && !String(details.headline ?? "").trim()) { why("no headline"); continue; }
    if (type === "contact" && !details.email && !details.phone) { why("no contact details"); continue; }
    out.push({ id: newId(), type, summary: summary || String(details.headline ?? type), details, sourceUrl: src, sourceTitle: u.sourceTitle ? String(u.sourceTitle).slice(0, 200) : null, quote });
  }
  return { updates: out.slice(0, 15), dropped, identity };
}

export interface AgentRunResult {
  status: "updates" | "no_changes" | "identity_unsure" | "error" | "refused" | "not_configured" | "not_included";
  proposed: number;
  note: string;
  costCents: number;
}

// Estimated $ per million tokens / per 1,000 searches (Claude Opus 5.5 list prices).
const PRICE = { input: 4, output: 20, perSearch: 0.01 };

export async function researchPlayer(db: Db, orgId: string, athleteId: string, opts: { client?: AgentClient | null; runId?: string | null } = {}): Promise<AgentRunResult> {
  const client = opts.client === undefined ? getAgentClient() : opts.client;
  if (!client) return { status: "not_configured", proposed: 0, note: "AI research isn't connected (add ANTHROPIC_API_KEY).", costCents: 0 };
  const access = await aiAccess(db, await getOrg(db, orgId));
  if (!access.canRun) return { status: "not_included", proposed: 0, note: access.message, costCents: 0 };
  const a = await getAthlete(db, orgId, athleteId);
  if (!a) return { status: "error", proposed: 0, note: "Player not found", costCents: 0 };
  if (a.optedOut) return { status: "error", proposed: 0, note: "Player opted out", costCents: 0 };

  const metrics = resolveAll(await listObservations(db, orgId, [athleteId]));
  const links = (await db.all<{ url: string }>("SELECT url FROM athlete_links WHERE org_id = ? AND athlete_id = ? UNION SELECT url FROM tracked_pages WHERE org_id = ? AND athlete_id = ?", [orgId, athleteId, orgId, athleteId])).map((r) => r.url);
  const last = await db.get<{ ran_at: string }>("SELECT ran_at FROM agent_runs WHERE org_id = ? AND athlete_id = ? AND status != 'error' ORDER BY ran_at DESC LIMIT 1", [orgId, athleteId]);

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: `Today is ${nowIso().slice(0, 10)}. Find what's new for this recruit.\n\nWhat the coaching staff already has:\n${JSON.stringify(knownProfile(a, metrics, links, last?.ran_at ?? null), null, 2)}` },
  ];
  const searchedUrls = new Set<string>();
  let inTok = 0, outTok = 0, searches = 0;
  let final: Anthropic.Beta.BetaMessage | null = null;
  try {
    for (let turn = 0; turn < 4; turn++) {
      const resp = await client.beta.messages.create({
        model: AGENT_MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        messages,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: MAX_SEARCHES }],
        output_config: { effort: "medium" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      inTok += resp.usage.input_tokens ?? 0;
      outTok += resp.usage.output_tokens ?? 0;
      searches += resp.usage.server_tool_use?.web_search_requests ?? 0;
      for (const block of resp.content) {
        if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
          for (const r of block.content) if (r.type === "web_search_result") searchedUrls.add(r.url);
        }
      }
      if (resp.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: resp.content });
        continue; // server tool loop paused; let it continue
      }
      final = resp;
      break;
    }
  } catch (e) {
    const note = e instanceof Anthropic.RateLimitError ? "AI service is busy; RC will retry later." : e instanceof Anthropic.AuthenticationError ? "AI key was rejected; check ANTHROPIC_API_KEY." : e instanceof Anthropic.APIError ? `AI service error ${e.status}` : String(e);
    return record(db, orgId, athleteId, { status: "error", proposed: 0, note, costCents: cost(inTok, outTok, searches) }, inTok, outTok, searches);
  }
  const costCents = cost(inTok, outTok, searches);
  if (!final || final.stop_reason === "refusal") {
    return record(db, orgId, athleteId, { status: final ? "refused" : "error", proposed: 0, note: final ? "The AI declined this request." : "Research didn't finish.", costCents }, inTok, outTok, searches);
  }
  const text = final.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n");
  const current = { metrics: new Map(Array.from(metrics.values()).map((m) => [m.key, m.primary.value])), links: new Set(links.map((l) => l.replace(/#.*$/, "").replace(/\/$/, "").toLowerCase())) };
  const v = validateUpdates(parseJsonBlock(text), searchedUrls, a, current);
  const name = `${a.firstName} ${a.lastName}`;
  if (!v.identity.confident) {
    return record(db, orgId, athleteId, { status: "identity_unsure", proposed: 0, note: `Couldn't confirm it was the right player: ${v.identity.reason}`.slice(0, 400), costCents }, inTok, outTok, searches);
  }
  if (v.updates.length === 0) {
    await logEvent(db, orgId, { type: "athlete_researched", message: `AI research on ${name}: nothing new`, athleteId, runId: opts.runId });
    return record(db, orgId, athleteId, { status: "no_changes", proposed: 0, note: v.dropped.length ? `Nothing new that RC could verify (${v.dropped.length} items set aside).` : "Nothing new found.", costCents }, inTok, outTok, searches);
  }
  await createApproval(db, orgId, {
    kind: "crm_update",
    title: `${v.updates.length} update${v.updates.length > 1 ? "s" : ""} for ${name}`,
    summary: v.updates.slice(0, 3).map((u) => u.summary).join(" · ") + (v.updates.length > 3 ? " …" : ""),
    payload: { updates: v.updates, identity: v.identity.reason },
    dedupeKey: `crm:${athleteId}:${v.updates.map((u) => `${u.type}:${u.sourceUrl}:${JSON.stringify(u.details)}`).join("|").slice(0, 900)}`,
    athleteId,
    runId: opts.runId,
  });
  await logEvent(db, orgId, { type: "athlete_researched", message: `AI research on ${name}: ${v.updates.length} update${v.updates.length > 1 ? "s" : ""} to review`, athleteId, runId: opts.runId });
  return record(db, orgId, athleteId, { status: "updates", proposed: v.updates.length, note: `${v.updates.length} updates proposed${v.dropped.length ? `, ${v.dropped.length} set aside` : ""}`, costCents }, inTok, outTok, searches);
}

function cost(inTok: number, outTok: number, searches: number) {
  return Math.round(((inTok / 1e6) * PRICE.input + (outTok / 1e6) * PRICE.output + searches * PRICE.perSearch) * 10000) / 100;
}

async function record(db: Db, orgId: string, athleteId: string, r: AgentRunResult, inTok: number, outTok: number, searches: number): Promise<AgentRunResult> {
  await db.run("INSERT INTO agent_runs (id, org_id, athlete_id, status, updates_proposed, input_tokens, output_tokens, searches, cost_cents, note, ran_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [
    newId(), orgId, athleteId, r.status, r.proposed, inTok, outTok, searches, r.costCents, r.note, nowIso(),
  ]);
  if (r.status === "error") await logEvent(db, orgId, { type: "job_failed", message: `AI research failed: ${r.note}`, athleteId });
  return r;
}

/** Background batch: researches board players that are due, within daily limits and a time budget. */
export async function runAgentBatch(db: Db, opts: { client?: AgentClient | null; deadline?: number; perOrg?: number } = {}) {
  const client = opts.client === undefined ? getAgentClient() : opts.client;
  if (!client) return [];
  const deadline = opts.deadline ?? Date.now() + 10 * 60_000;
  const out = [];
  for (const { org_id } of await db.all<{ org_id: string }>("SELECT DISTINCT org_id FROM follows")) {
    if (Date.now() > deadline) break;
    const org = await getOrg(db, org_id);
    if (!org.settings.agent.enabled) continue;
    const access = await aiAccess(db, org);
    if (!access.automatic) continue; // automatic research is the paid add-on; trials are manual only
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const today = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM agent_runs WHERE org_id = ? AND ran_at > ?", [org_id, dayAgo]);
    let budget = Math.min(opts.perOrg ?? Number(process.env.RC_AGENT_PER_RUN ?? 10), org.settings.agent.maxPerDay - Number(today?.n ?? 0), access.monthlyLimit - access.usedThisMonth);
    if (budget <= 0) continue;
    const cutoff = new Date(Date.now() - org.settings.agent.everyDays * 86_400_000).toISOString();
    const requested = org.settings.agent.boardRequestedAt;
    const due = await db.all<{ athlete_id: string; last: string | null }>(
      `SELECT f.athlete_id, (SELECT MAX(ran_at) FROM agent_runs r WHERE r.org_id = f.org_id AND r.athlete_id = f.athlete_id) AS last
       FROM follows f JOIN athletes a ON a.id = f.athlete_id WHERE f.org_id = ? AND a.opted_out = 0 AND f.board_status != 'not_a_fit'`,
      [org_id],
    );
    const todo = due
      .filter((d) => !d.last || d.last < cutoff || (requested && d.last < requested))
      .sort((x, y) => (x.last ?? "").localeCompare(y.last ?? ""));
    let done = 0;
    for (const d of todo) {
      if (budget-- <= 0 || Date.now() > deadline) break;
      const r = await researchPlayer(db, org_id, d.athlete_id, { client });
      done++;
      if (r.status === "error" && /busy|rejected/.test(r.note)) break;
    }
    out.push({ orgId: org_id, researched: done, remaining: Math.max(0, todo.length - done) });
  }
  return out;
}
