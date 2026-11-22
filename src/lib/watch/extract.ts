// Reads season stats from a public player stats page. Site-agnostic on purpose:
// it looks for (1) structured data embedded in the page (JSON-LD / Next.js
// data blobs) and (2) HTML stat tables whose headers are standard baseball
// abbreviations. It never guesses: a value is only returned when a recognised
// label sits next to a number. Anything ambiguous is left out and reported.

import { parse, type HTMLElement } from "node-html-parser";

export interface ExtractedStat {
  key: string;
  value: number;
  label: string; // the label as printed on the page, e.g. "AVG"
}

export interface Extraction {
  stats: ExtractedStat[];
  method: "table" | "embedded-json" | "none";
  season: string | null; // e.g. "2026" or "25-26" when the page says so
  notes: string[];
}

// Header label → RC metric key. Batting and pitching tables share some labels
// (H, BB, SO), so pitching-only keys are resolved by table context below.
const BATTING: Record<string, string> = {
  AVG: "avg", BA: "avg", "BATTING AVG": "avg", OBP: "obp", "OB%": "obp", SLG: "slg", "SLG%": "slg", OPS: "ops",
  H: "hits", HITS: "hits", HR: "hr", "HOME RUNS": "hr", RBI: "rbi", RBIS: "rbi", SB: "sb", "STOLEN BASES": "sb",
};
const PITCHING: Record<string, string> = {
  ERA: "era", IP: "ip", "INNINGS PITCHED": "ip", SO: "k_pitch", K: "k_pitch", KS: "k_pitch", BB: "bb_pitch", WHIP: "whip",
};
const PITCHING_ONLY = new Set(["ERA", "IP", "WHIP", "INNINGS PITCHED"]);

function norm(label: string) {
  return label.replace(/\s+/g, " ").replace(/[^A-Za-z%' ]/g, "").trim().toUpperCase();
}

function toNumber(raw: string): number | null {
  const s = raw.replace(/,/g, "").trim();
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/** Innings like "23.2" mean 23⅔ — keep as printed (baseball convention) but validate the decimal. */
export function validFor(key: string, v: number): boolean {
  switch (key) {
    case "avg": case "obp": return v >= 0 && v <= 1;
    case "slg": return v >= 0 && v <= 4;
    case "ops": return v >= 0 && v <= 5;
    case "era": case "whip": return v >= 0 && v <= 50;
    case "ip": return v >= 0 && v <= 200 && [0, 1, 2].includes(Math.round((v % 1) * 10));
    default: return Number.isInteger(v) && v >= 0 && v <= 500;
  }
}

function seasonFrom(text: string): string | null {
  const m = text.match(/\b(20\d{2})(?:\s*[-–/]\s*(\d{2,4}))?\s*(?:season|spring|varsity)?/i);
  return m ? (m[2] ? `${m[1]}-${m[2].slice(-2)}` : m[1]) : null;
}

function rowCells(tr: HTMLElement): string[] {
  return tr.querySelectorAll("th,td").map((c) => c.text.replace(/\s+/g, " ").trim());
}

/** Pick the row that represents the current/total season from a stats table. */
function pickRow(rows: string[][]): { cells: string[]; season: string | null } | null {
  const data = rows.filter((r) => r.some((c) => toNumber(c) !== null));
  if (data.length === 0) return null;
  // Prefer an explicit season-total row ("Totals", "Season", "Career" is excluded: it's multi-year).
  const total = data.find((r) => /^(season|totals?|overall)$/i.test(r[0] ?? ""));
  if (total) return { cells: total, season: null };
  const nonCareer = data.filter((r) => !/career/i.test(r[0] ?? ""));
  // Rows labelled by year: take the latest year.
  const withYear = nonCareer.map((r) => ({ r, y: seasonFrom(r[0] ?? "") })).filter((x) => x.y);
  if (withYear.length) {
    withYear.sort((a, b) => (a.y! < b.y! ? 1 : -1));
    return { cells: withYear[0].r, season: withYear[0].y };
  }
  return nonCareer.length === 1 ? { cells: nonCareer[0], season: null } : null;
}

function fromTables(root: HTMLElement, notes: string[]): { stats: ExtractedStat[]; season: string | null } {
  const found = new Map<string, ExtractedStat>();
  let season: string | null = null;
  for (const table of root.querySelectorAll("table")) {
    const trs = table.querySelectorAll("tr");
    if (trs.length < 2) continue;
    const header = rowCells(trs[0]).map(norm);
    const isPitching = header.some((h) => PITCHING_ONLY.has(h));
    const map = isPitching ? PITCHING : BATTING;
    const cols = header.map((h) => map[h] ?? null);
    if (cols.filter(Boolean).length < 2) continue; // not a stats table
    const picked = pickRow(trs.slice(1).map(rowCells));
    if (!picked) {
      notes.push(`Found a ${isPitching ? "pitching" : "batting"} table but couldn't tell which row is this season; skipped it.`);
      continue;
    }
    season = season ?? picked.season ?? seasonFrom(table.parentNode?.text?.slice(0, 200) ?? "");
    cols.forEach((key, i) => {
      if (!key || found.has(key)) return;
      const v = toNumber(picked.cells[i] ?? "");
      if (v === null) return;
      if (!validFor(key, v)) {
        notes.push(`${header[i]} value "${picked.cells[i]}" looks wrong for that stat; skipped.`);
        return;
      }
      found.set(key, { key, value: v, label: header[i] });
    });
  }
  return { stats: Array.from(found.values()), season };
}

// Embedded JSON: walk objects looking for stat-named keys with numeric values.
const JSON_KEYS: Record<string, string> = {
  battingaverage: "avg", avg: "avg", ba: "avg", onbasepercentage: "obp", obp: "obp", sluggingpercentage: "slg", slg: "slg", ops: "ops",
  hits: "hits", homeruns: "hr", hr: "hr", runsbattedin: "rbi", rbi: "rbi", stolenbases: "sb", sb: "sb",
  earnedrunaverage: "era", era: "era", inningspitched: "ip", ip: "ip", whip: "whip", pitchingstrikeouts: "k_pitch", strikeoutspitched: "k_pitch",
};

function fromEmbeddedJson(html: string, notes: string[]): ExtractedStat[] {
  const blobs: unknown[] = [];
  for (const m of html.matchAll(/<script[^>]*type=["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      blobs.push(JSON.parse(m[1]));
    } catch {
      /* not JSON */
    }
  }
  const found = new Map<string, ExtractedStat>();
  let objectsWithStats = 0;
  const walk = (node: unknown, depth: number) => {
    if (depth > 40 || node == null) return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
    if (typeof node !== "object") return;
    const local: ExtractedStat[] = [];
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const key = JSON_KEYS[k.toLowerCase().replace(/[^a-z]/g, "")];
      const num = typeof v === "number" ? v : typeof v === "string" ? toNumber(v) : null;
      if (key && num !== null && validFor(key, num)) local.push({ key, value: num, label: k });
    }
    // Only trust an object that carries several stats together (a stat line), not a lone stray number.
    if (local.length >= 2) {
      objectsWithStats++;
      for (const s of local) if (!found.has(s.key)) found.set(s.key, s);
    }
    for (const v of Object.values(node as Record<string, unknown>)) if (typeof v === "object") walk(v, depth + 1);
  };
  blobs.forEach((b) => walk(b, 0));
  if (objectsWithStats > 1) notes.push("The page had more than one stat line in its data; RC used the first one found. Check the source if it looks off.");
  return Array.from(found.values());
}

export function extractStats(html: string): Extraction {
  const notes: string[] = [];
  const root = parse(html, { blockTextElements: { script: false, style: false } });
  const tables = fromTables(root, notes);
  if (tables.stats.length >= 2) return { stats: tables.stats, method: "table", season: tables.season, notes };
  const json = fromEmbeddedJson(html, notes);
  if (json.length >= 2) return { stats: json, method: "embedded-json", season: seasonFrom(root.querySelector("title")?.text ?? ""), notes };
  notes.push("No recognizable stats found on this page. It may need a login, load stats with JavaScript, or use a layout RC doesn't read yet.");
  return { stats: [], method: "none", season: null, notes };
}
