// Polite fetching of public pages: identifies itself, obeys robots.txt,
// rate-limits per site, never sends cookies or logs in, caps page size, and
// uses conditional requests so unchanged pages cost the site almost nothing.

export const USER_AGENT = "RC-RecruitingCoordinator/1.0 (stat monitor for followed players; +https://theathletemarket.com/rc-bot)";
const MIN_INTERVAL_MS = Number(process.env.RC_WATCH_MIN_INTERVAL_MS ?? 8000); // per site
const MAX_BYTES = 3_000_000;
const TIMEOUT_MS = 20_000;

export interface FetchResult {
  status: "ok" | "not_modified" | "blocked_by_robots" | "login_required" | "http_error" | "network_error" | "too_large";
  httpStatus?: number;
  html?: string;
  etag?: string | null;
  lastModified?: string | null;
  detail?: string;
}

// ---------- robots.txt ----------

interface RobotsRules { allow: string[]; disallow: string[]; crawlDelayMs: number | null }

export function parseRobots(text: string, agent = "RC-RecruitingCoordinator"): RobotsRules {
  const groups: Array<{ agents: string[]; allow: string[]; disallow: string[]; delay: number | null }> = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const field = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (field === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], allow: [], disallow: [], delay: null };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (field === "allow") cur.allow.push(value);
    else if (field === "disallow") cur.disallow.push(value);
    else if (field === "crawl-delay" && Number(value) > 0) cur.delay = Number(value) * 1000;
  }
  const mine = groups.find((g) => g.agents.some((a) => a !== "*" && agent.toLowerCase().includes(a)));
  const any = groups.find((g) => g.agents.includes("*"));
  const g = mine ?? any;
  return { allow: g?.allow ?? [], disallow: (g?.disallow ?? []).filter(Boolean), crawlDelayMs: g?.delay ?? null };
}

function ruleMatches(rule: string, path: string): number {
  // Supports * wildcards and $ end anchor; returns match length (specificity) or -1.
  const re = new RegExp("^" + rule.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*").replace(/\\\$$/, "$"));
  return re.test(path) ? rule.length : -1;
}

export function robotsAllows(rules: RobotsRules, path: string): boolean {
  let best = -1;
  let allowed = true;
  for (const r of rules.disallow) {
    const n = ruleMatches(r, path);
    if (n > best) [best, allowed] = [n, false];
  }
  for (const r of rules.allow) {
    const n = ruleMatches(r, path);
    if (n >= best && n >= 0) [best, allowed] = [n, true];
  }
  return allowed;
}

const robotsCache = new Map<string, { rules: RobotsRules; at: number }>();
const lastHit = new Map<string, number>();

async function getRobots(origin: string, fetchImpl: typeof fetch): Promise<RobotsRules> {
  const c = robotsCache.get(origin);
  if (c && Date.now() - c.at < 24 * 3600_000) return c.rules;
  let rules: RobotsRules = { allow: [], disallow: [], crawlDelayMs: null };
  try {
    const r = await fetchImpl(`${origin}/robots.txt`, { headers: { "User-Agent": USER_AGENT }, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (r.ok) rules = parseRobots(await r.text());
    // 4xx: no robots.txt → allowed. 5xx: be conservative and treat the site as off-limits for now.
    else if (r.status >= 500) rules = { allow: [], disallow: ["/"], crawlDelayMs: null };
  } catch {
    rules = { allow: [], disallow: ["/"], crawlDelayMs: null };
  }
  robotsCache.set(origin, { rules, at: Date.now() });
  return rules;
}

async function waitTurn(origin: string, delayMs: number) {
  const last = lastHit.get(origin) ?? 0;
  const wait = last + delayMs - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(origin, Date.now());
}

export async function politeFetch(
  url: string,
  prev: { etag?: string | null; lastModified?: string | null } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<FetchResult> {
  const u = new URL(url);
  const robots = await getRobots(u.origin, fetchImpl);
  if (!robotsAllows(robots, u.pathname + u.search)) {
    return { status: "blocked_by_robots", detail: `${u.hostname} asks automated tools not to read this page (robots.txt). RC respects that.` };
  }
  await waitTurn(u.origin, Math.max(MIN_INTERVAL_MS, robots.crawlDelayMs ?? 0));
  const headers: Record<string, string> = { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" };
  if (prev.etag) headers["If-None-Match"] = prev.etag;
  if (prev.lastModified) headers["If-Modified-Since"] = prev.lastModified;
  let r: Response;
  try {
    r = await fetchImpl(url, { headers, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    return { status: "network_error", detail: e instanceof Error ? e.message : String(e) };
  }
  if (r.status === 304) return { status: "not_modified", httpStatus: 304 };
  if (r.status === 401 || r.status === 403) return { status: "login_required", httpStatus: r.status, detail: "This page needs a login or blocks automated reading. RC doesn't log in or get around that." };
  if (!r.ok) return { status: "http_error", httpStatus: r.status, detail: `The site answered ${r.status}.` };
  const len = Number(r.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) return { status: "too_large", detail: "Page is unusually large; skipped." };
  const html = await r.text();
  if (html.length > MAX_BYTES) return { status: "too_large", detail: "Page is unusually large; skipped." };
  if (/<input[^>]+type=["']password["']/i.test(html) && !/<table/i.test(html)) {
    return { status: "login_required", httpStatus: r.status, detail: "This page shows a sign-in form instead of stats. RC doesn't log in." };
  }
  return { status: "ok", httpStatus: r.status, html, etag: r.headers.get("etag"), lastModified: r.headers.get("last-modified") };
}

export function siteLabel(url: string): string {
  const h = new URL(url).hostname.replace(/^www\./, "");
  if (h.endsWith("maxpreps.com")) return "MaxPreps";
  if (h.endsWith("perfectgame.org")) return "Perfect Game";
  if (h.endsWith("prepbaseballreport.com") || h.endsWith("prepbaseball.com")) return "Prep Baseball Report";
  if (h.endsWith("hudl.com")) return "Hudl";
  return h;
}

/** For tests: forget cached robots rules and rate-limit timestamps. */
export function resetFetcherState() {
  robotsCache.clear();
  lastHit.clear();
}
