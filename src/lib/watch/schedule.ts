// Reads upcoming games from a public schedule page (team schedule on MaxPreps,
// a school site, a tournament page…). Site-agnostic: finds tables whose headers
// include a date column and an opponent column. Only future games are kept;
// rows marked canceled/postponed are reported as such. Times are read as the
// program's local time.

import { parse } from "node-html-parser";
import { zonedToUtc } from "../domain/time";

export interface ScheduledGame {
  startsAt: string; // UTC ISO
  timeKnown: boolean;
  opponent: string;
  home: boolean | null;
  location: string | null;
  status: "scheduled" | "cancelled";
  key: string; // stable id for change detection
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

/** "3/5", "Tue 3/5", "03/05/2027", "Mar 5", "March 5, 2027", "2027-03-05" → {y,m,d}. Year inferred as the next occurrence. */
export function parseGameDate(raw: string, now = new Date()): { y: number; m: number; d: number } | null {
  const s = raw.trim();
  let y: number | null = null;
  let m: number | null = null;
  let d: number | null = null;
  let mm = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (mm) [y, m, d] = [Number(mm[1]), Number(mm[2]), Number(mm[3])];
  if (!m) {
    mm = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (mm) {
      [m, d] = [Number(mm[1]), Number(mm[2])];
      if (mm[3]) y = mm[3].length === 2 ? 2000 + Number(mm[3]) : Number(mm[3]);
    }
  }
  if (!m) {
    mm = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/i);
    if (mm) {
      [m, d] = [MONTHS[mm[1].toLowerCase()], Number(mm[2])];
      if (mm[3]) y = Number(mm[3]);
    }
  }
  if (!m || !d || m > 12 || d > 31) return null;
  if (!y) {
    y = now.getUTCFullYear();
    // A date more than ~2 months in the past most likely means next year's season.
    const candidate = Date.UTC(y, m - 1, d);
    if (candidate < now.getTime() - 60 * 86_400_000) y += 1;
  }
  return { y, m, d };
}

export function parseGameTime(raw: string): { h: number; min: number } | null {
  const mm = raw.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i) ?? raw.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!mm) return null;
  let h = Number(mm[1]);
  const min = Number(mm[2] ?? 0);
  const ap = mm[3]?.toLowerCase().replace(/\./g, "");
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return { h, min };
}

function norm(h: string) {
  return h.toLowerCase().replace(/[^a-z@ ]/g, "").trim();
}

export function extractSchedule(html: string, tz: string, now = new Date()): { games: ScheduledGame[]; notes: string[] } {
  const notes: string[] = [];
  const games: ScheduledGame[] = [];
  const root = parse(html);
  for (const table of root.querySelectorAll("table")) {
    const trs = table.querySelectorAll("tr");
    if (trs.length < 2) continue;
    const header = trs[0].querySelectorAll("th,td").map((c) => norm(c.text));
    const dateCol = header.findIndex((h) => /^(date|day|game date|when)$/.test(h));
    const oppCol = header.findIndex((h) => /^(opponent|opp|vs|versus|team|matchup|game)$/.test(h));
    if (dateCol < 0 || oppCol < 0) continue;
    const timeCol = header.findIndex((h) => /^(time|start|start time)$/.test(h));
    const locCol = header.findIndex((h) => /^(location|site|venue|field|where)$/.test(h));
    const resultCol = header.findIndex((h) => /^(result|score|wl|final)$/.test(h));
    for (const tr of trs.slice(1)) {
      const cells = tr.querySelectorAll("td,th").map((c) => c.text.replace(/\s+/g, " ").trim());
      if (cells.length <= Math.max(dateCol, oppCol)) continue;
      const date = parseGameDate(cells[dateCol], now);
      if (!date) continue;
      const rowText = cells.join(" ");
      // Already played (has a result like "W 5-2") → not upcoming.
      if (resultCol >= 0 && /\b[WLT]\b|\d+\s*-\s*\d+/.test(cells[resultCol] ?? "")) continue;
      const cancelled = /cancel+ed|postponed|ppd\b/i.test(rowText);
      const time = parseGameTime(timeCol >= 0 ? cells[timeCol] : cells[dateCol]);
      const startsAt = zonedToUtc(date.y, date.m, date.d, time?.h ?? 12, time?.min ?? 0, tz);
      if (new Date(startsAt).getTime() < now.getTime() - 3 * 3600_000) continue;
      let opp = cells[oppCol].replace(/^(vs\.?|@|at)\s+/i, "").replace(/\s*\(.*?\)\s*$/, "").trim();
      if (!opp) continue;
      const home = /^@|^at\s/i.test(cells[oppCol]) ? false : /^vs/i.test(cells[oppCol]) ? true : null;
      opp = opp.slice(0, 80);
      games.push({
        startsAt, timeKnown: Boolean(time), opponent: opp, home,
        location: locCol >= 0 ? cells[locCol] || null : null,
        status: cancelled ? "cancelled" : "scheduled",
        // Key on opponent + date (not time) so a time change is detected as a change.
        key: `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}|${opp.toLowerCase()}`,
      });
    }
  }
  return { games, notes };
}
