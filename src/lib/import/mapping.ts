// Brings a coach's existing recruiting list (CSV, Excel or Google Sheet) into
// RC. Columns are matched by meaning, not exact name, and the coach confirms
// the mapping before anything is saved. Nothing is invented: a cell that
// can't be read (e.g. "tall" in a height column) is skipped and reported.

import { normalizeState } from "../domain/geo";
import { parseHeight } from "../domain/metrics";
import { safeUrl } from "../domain/urls";
import type { ProviderAthleteRecord } from "../providers/types";
import { normalizePhone, normalizeXHandle } from "../repo";

export type FieldId =
  | "ignore" | "full_name" | "first_name" | "last_name" | "grad_year" | "position" | "secondary_position" | "high_school"
  | "team" | "city" | "state" | "zip" | "height" | "weight" | "exit_velo" | "sixty" | "inf_velo" | "of_velo" | "fb_velo"
  | "pop_time" | "gpa" | "email" | "guardian_email" | "phone" | "x_handle" | "notes" | "status" | "committed" | "profile_url" | "film_url";

export const FIELDS: Array<{ id: FieldId; label: string; synonyms: string[] }> = [
  { id: "ignore", label: "Don't import", synonyms: [] },
  { id: "full_name", label: "Player name (full)", synonyms: ["name", "player", "player name", "athlete", "athlete name", "full name", "prospect", "recruit"] },
  { id: "first_name", label: "First name", synonyms: ["first", "first name", "fname", "given name"] },
  { id: "last_name", label: "Last name", synonyms: ["last", "last name", "lname", "surname", "family name"] },
  { id: "grad_year", label: "Grad year / class", synonyms: ["grad", "grad year", "grad yr", "class", "class of", "year", "yr", "hs grad", "graduation", "graduation year"] },
  { id: "position", label: "Position", synonyms: ["pos", "position", "primary position", "prim pos", "positions", "pos 1"] },
  { id: "secondary_position", label: "Secondary position", synonyms: ["secondary", "secondary position", "2nd pos", "pos 2", "sec pos", "alt position"] },
  { id: "high_school", label: "High school", synonyms: ["hs", "high school", "school", "highschool", "h s"] },
  { id: "team", label: "Travel / club team", synonyms: ["team", "travel team", "club", "club team", "summer team", "travel"] },
  { id: "city", label: "City", synonyms: ["city", "hometown", "town"] },
  { id: "state", label: "State", synonyms: ["state", "st"] },
  { id: "zip", label: "ZIP code", synonyms: ["zip", "zip code", "zipcode", "postal code"] },
  { id: "height", label: "Height", synonyms: ["height", "ht", "hgt"] },
  { id: "weight", label: "Weight (lb)", synonyms: ["weight", "wt", "wgt", "lbs"] },
  { id: "exit_velo", label: "Exit velocity (mph)", synonyms: ["ev", "exit velo", "exit velocity", "exit", "exit vel", "bat speed ev", "max ev"] },
  { id: "sixty", label: "60-yard time (sec)", synonyms: ["60", "60 yd", "60 yard", "60 time", "sixty", "60yd", "60 yard dash"] },
  { id: "inf_velo", label: "Infield velo (mph)", synonyms: ["if velo", "inf velo", "infield velo", "inf", "if"] },
  { id: "of_velo", label: "Outfield velo (mph)", synonyms: ["of velo", "outfield velo", "of arm"] },
  { id: "fb_velo", label: "Fastball velo (mph)", synonyms: ["fb", "fb velo", "fastball", "fastball velo", "velo", "top velo", "fb max"] },
  { id: "pop_time", label: "Pop time (sec)", synonyms: ["pop", "pop time", "poptime"] },
  { id: "gpa", label: "GPA", synonyms: ["gpa", "grades", "academic gpa"] },
  { id: "email", label: "Player email", synonyms: ["email", "e mail", "player email", "athlete email"] },
  { id: "guardian_email", label: "Parent email", synonyms: ["parent email", "guardian email", "mom email", "dad email", "parent e mail"] },
  { id: "phone", label: "Player phone", synonyms: ["phone", "cell", "phone number", "mobile", "cell phone", "number", "player phone"] },
  { id: "x_handle", label: "X / Twitter", synonyms: ["x", "twitter", "x handle", "twitter handle", "x twitter", "twitter x", "handle"] },
  { id: "notes", label: "Notes", synonyms: ["notes", "note", "comments", "comment", "eval", "evaluation", "report", "scouting notes", "thoughts"] },
  { id: "status", label: "Board status / priority", synonyms: ["status", "priority", "tier", "rank", "interest", "board", "level"] },
  { id: "committed", label: "Committed?", synonyms: ["committed", "commitment", "commit", "committed to", "college"] },
  { id: "profile_url", label: "Stats page link (MaxPreps, PG…)", synonyms: ["maxpreps", "max preps", "maxpreps link", "pg", "pg link", "perfect game", "perfect game link", "pbr", "pbr link", "profile", "profile link", "stats link", "link", "url"] },
  { id: "film_url", label: "Film / video link", synonyms: ["film", "video", "highlights", "hudl", "youtube", "film link", "video link"] },
];

function normHeader(h: string) {
  return h.toLowerCase().replace(/[_\-./#()]+/g, " ").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

/** Best-guess mapping from the sheet's headers to RC fields. Each RC field is used at most once. */
export function guessMapping(headers: string[], sampleRows: string[][] = []): FieldId[] {
  const used = new Set<FieldId>();
  const out: FieldId[] = headers.map(() => "ignore");
  // Pass 1: exact synonym matches. Pass 2: header contains a multi-word synonym.
  for (const pass of [1, 2]) {
    headers.forEach((raw, i) => {
      if (out[i] !== "ignore") return;
      const h = normHeader(raw);
      for (const f of FIELDS) {
        if (f.id === "ignore" || used.has(f.id)) continue;
        const hit = pass === 1 ? f.synonyms.includes(h) : f.synonyms.some((s) => s.length > 3 && h.includes(s));
        if (hit) {
          out[i] = f.id;
          used.add(f.id);
          return;
        }
      }
    });
  }
  // Pass 3: unnamed link columns — if the cells are URLs, classify by site.
  headers.forEach((_, i) => {
    if (out[i] !== "ignore") return;
    const vals = sampleRows.map((r) => r[i] ?? "").filter(Boolean);
    if (vals.length && vals.every((v) => /^https?:\/\//i.test(v))) {
      const film = vals.some((v) => /youtube|youtu\.be|hudl|vimeo/i.test(v));
      const id: FieldId = film ? "film_url" : "profile_url";
      if (!used.has(id)) {
        out[i] = id;
        used.add(id);
      }
    }
  });
  // If both first/last exist, a "name" column is probably redundant.
  if (out.includes("first_name") && out.includes("last_name")) out.forEach((f, i) => f === "full_name" && (out[i] = "ignore"));
  return out;
}

const POS_WORDS: Record<string, string> = {
  shortstop: "SS", ss: "SS", "second base": "2B", "2b": "2B", "third base": "3B", "3b": "3B", "first base": "1B", "1b": "1B",
  catcher: "C", c: "C", "center field": "CF", cf: "CF", outfield: "OF", of: "OF", lf: "LF", rf: "RF", "left field": "LF", "right field": "RF",
  rhp: "RHP", lhp: "LHP", "right handed pitcher": "RHP", "left handed pitcher": "LHP", p: "RHP", pitcher: "RHP", inf: "INF", if: "INF", mif: "SS", util: "UTIL", utility: "UTIL",
};

export function normalizePositions(raw: string): string[] {
  return raw
    .split(/[\/,;&|]+|\s+and\s+/i)
    .map((p) => POS_WORDS[p.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "")] ?? null)
    .filter((p): p is string => Boolean(p));
}

export function parseGradYear(raw: string): number | null {
  const s = raw.trim();
  let m = s.match(/\b(20[2-4]\d)\b/);
  if (m) return Number(m[1]);
  m = s.match(/^'?(\d{2})$/);
  if (m && Number(m[1]) >= 20 && Number(m[1]) <= 40) return 2000 + Number(m[1]);
  return null;
}

const STATUS_WORDS: Array<[RegExp, string]> = [
  [/\b(top|a|1|high|priority|must|offer|hot)\b/i, "priority"],
  [/\b(b|2|med|medium|evaluat|maybe|follow)\b/i, "evaluating"],
  [/\b(contact|called|texted|emailed|reached)\b/i, "contacted"],
  [/\b(no|pass|not a fit|nf|cut|drop)\b/i, "not_a_fit"],
  [/\b(c|3|low|watch)\b/i, "watching"],
];

export function parseBoardStatus(raw: string): string | null {
  if (!raw.trim()) return null;
  for (const [re, s] of STATUS_WORDS) if (re.test(raw)) return s;
  return "watching";
}

export interface MappedRow {
  record: ProviderAthleteRecord;
  note: string | null;
  boardStatus: string;
}

export interface MappingResult {
  rows: MappedRow[];
  skipped: Array<{ row: number; reason: string }>;
  warnings: string[];
}

function num(raw: string): number | null {
  const v = Number(raw.replace(/[^\d.]/g, ""));
  return raw.trim() && Number.isFinite(v) && v > 0 ? v : null;
}

export function applyMapping(headers: string[], rows: string[][], mapping: FieldId[], listName: string): MappingResult {
  const res: MappingResult = { rows: [], skipped: [], warnings: [] };
  const warnedCols = new Set<number>();
  const has = (f: FieldId) => mapping.includes(f);
  if (!has("full_name") && !(has("first_name") && has("last_name"))) {
    res.warnings.push("Pick which column has the player's name (one full-name column, or first and last name columns).");
    return res;
  }
  rows.forEach((cells, idx) => {
    const line = idx + 2;
    const get = (f: FieldId) => {
      const i = mapping.indexOf(f);
      return i >= 0 ? String(cells[i] ?? "").trim() : "";
    };
    let first = get("first_name");
    let last = get("last_name");
    if ((!first || !last) && get("full_name")) {
      const full = get("full_name").replace(/\s+/g, " ");
      const comma = full.match(/^([^,]+),\s*(.+)$/); // "Pike, Jordan"
      if (comma) [last, first] = [comma[1], comma[2]];
      else {
        const parts = full.split(" ");
        first = parts[0] ?? "";
        last = parts.slice(1).join(" ");
      }
    }
    if (!first || !last) {
      if (cells.some((c) => String(c ?? "").trim())) res.skipped.push({ row: line, reason: "No first and last name" });
      return;
    }
    const metrics: NonNullable<ProviderAthleteRecord["metrics"]> = [];
    const addMetric = (field: FieldId, key: string, parseFn: (s: string) => number | null) => {
      const raw = get(field);
      if (!raw) return;
      const v = parseFn(raw);
      if (v == null) {
        const col = mapping.indexOf(field);
        if (!warnedCols.has(col)) {
          res.warnings.push(`Some "${headers[col]}" values couldn't be read as numbers (e.g. "${raw}") and were left out.`);
          warnedCols.add(col);
        }
        return;
      }
      metrics.push({ key, value: v, measuredAt: null, verification: "unverified", eventName: `From ${listName}` });
    };
    addMetric("height", "height_in", (s) => parseHeight(s) ?? (num(s) && num(s)! >= 48 && num(s)! <= 90 ? num(s) : null));
    addMetric("weight", "weight_lb", (s) => { const v = num(s); return v && v >= 90 && v <= 350 ? v : null; });
    addMetric("exit_velo", "exit_velo_mph", (s) => { const v = num(s); return v && v >= 40 && v <= 130 ? v : null; });
    addMetric("sixty", "sixty_yd_sec", (s) => { const v = num(s); return v && v >= 5.5 && v <= 10 ? v : null; });
    addMetric("inf_velo", "inf_velo_mph", (s) => { const v = num(s); return v && v >= 40 && v <= 110 ? v : null; });
    addMetric("of_velo", "of_velo_mph", (s) => { const v = num(s); return v && v >= 40 && v <= 115 ? v : null; });
    addMetric("fb_velo", "fb_velo_mph", (s) => { const v = num(s); return v && v >= 40 && v <= 110 ? v : null; });
    addMetric("pop_time", "pop_time_sec", (s) => { const v = num(s); return v && v >= 1.5 && v <= 3 ? v : null; });
    addMetric("gpa", "gpa", (s) => { const v = num(s); return v && v <= 5 ? v : null; });

    const positions = normalizePositions(get("position"));
    const second = normalizePositions(get("secondary_position"));
    const committedRaw = get("committed");
    const committed = committedRaw
      ? /^(no|n|uncommitted|none|open|-)$/i.test(committedRaw) ? "uncommitted" : "committed"
      : "unknown";
    const phone = normalizePhone(get("phone"));
    const noteParts = [get("notes"), get("phone") && !phone ? `Phone: ${get("phone")}` : "", committed === "committed" && !/^(yes|y|true|x)$/i.test(committedRaw) ? `Committed: ${committedRaw}` : ""].filter(Boolean);
    const profile = get("profile_url").split(/[\s;,]+/).map((u) => safeUrl(u)).filter((u): u is string => Boolean(u));
    const film = safeUrl(get("film_url"));
    res.rows.push({
      record: {
        firstName: first.trim(),
        lastName: last.trim(),
        gradYear: parseGradYear(get("grad_year")),
        primaryPosition: positions[0] ?? null,
        secondaryPosition: second[0] ?? positions[1] ?? null,
        highSchool: get("high_school") || null,
        team: get("team") || null,
        city: get("city") || null,
        state: normalizeState(get("state")) ?? null,
        zip: get("zip") || null,
        email: get("email") || null,
        guardianEmail: get("guardian_email") || null,
        phone,
        xHandle: normalizeXHandle(get("x_handle")),
        commitmentStatus: committed,
        commitmentVerified: false,
        metrics,
        film: film ? [{ url: film, title: "Film from your list", recordedAt: null }] : [],
        profileUrls: profile,
      },
      note: noteParts.length ? noteParts.join("\n") : null,
      boardStatus: parseBoardStatus(get("status")) ?? "watching",
    });
  });
  return res;
}

/** Turns a Google Sheets share link into its CSV export link. */
export function googleSheetCsvUrl(link: string): string | null {
  const m = link.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) return null;
  const gid = link.match(/[#&?]gid=(\d+)/)?.[1] ?? "0";
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
}
