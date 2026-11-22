// One-tap export: a coach can take their whole board with them at any time,
// paid or not. Opens straight in Excel, Numbers or Google Sheets.

import type { Db } from "./db";
import { listAthletes, listFollows, listObservations } from "./repo";
import { resolveAll } from "./domain/provenance";
import { MEASURABLE_KEYS, METRICS, SEASON_STAT_KEYS } from "./domain/metrics";
import { CONTACT_KINDS, lastContacts } from "./repo/contacts";

/** Quotes a cell, and stops spreadsheet apps from treating text as a formula. */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[=+@\t\r]/.test(s) || /^-[^\d.]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const BOARD_LABEL: Record<string, string> = { priority: "Priority", evaluating: "Evaluating", watching: "Watching", contacted: "Contacted", not_a_fit: "Not a fit" };

export async function boardCsv(db: Db, orgId: string): Promise<{ csv: string; count: number }> {
  const follows = await listFollows(db, orgId);
  const ids = follows.map((f) => f.athlete_id);
  const athletes = new Map((await listAthletes(db, orgId, { ids })).map((a) => [a.id, a]));
  const obs = await listObservations(db, orgId, ids);
  const last = await lastContacts(db, orgId, ids);
  const inList = (col: string) => (ids.length ? `${col} IN (${ids.map(() => "?").join(",")})` : "1=0");
  const notes = await db.all<{ athlete_id: string; body: string; created_at: string; name: string | null }>(
    `SELECT n.athlete_id, n.body, n.created_at, u.name FROM notes n LEFT JOIN users u ON u.id = n.user_id WHERE n.org_id = ? AND ${inList("n.athlete_id")} ORDER BY n.created_at`,
    [orgId, ...ids],
  );
  const links = await db.all<{ athlete_id: string; url: string }>(`SELECT athlete_id, url FROM athlete_links WHERE org_id = ? AND ${inList("athlete_id")} ORDER BY created_at`, [orgId, ...ids]);
  const group = <T extends { athlete_id: string }>(rows: T[]) => rows.reduce((m, r) => m.set(r.athlete_id, [...(m.get(r.athlete_id) ?? []), r]), new Map<string, T[]>());
  const notesBy = group(notes);
  const linksBy = group(links);

  // Only include metric columns someone on the board actually has.
  const resolved = new Map(ids.map((id) => [id, resolveAll(obs.filter((o) => o.athleteId === id))]));
  const metricKeys = [...MEASURABLE_KEYS, ...SEASON_STAT_KEYS].filter((k) => [...resolved.values()].some((m) => m.has(k)));

  const header = [
    "First name", "Last name", "Grad year", "Position", "Secondary position", "Bats/Throws", "High school", "Team", "City", "State", "ZIP",
    "Board status", "Commitment", "Player email", "Parent email", "Phone", "X",
    ...metricKeys.flatMap((k) => [METRICS[k].label, `${METRICS[k].label} source`]),
    "Last contact", "Links", "Staff notes", "Added to board",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const f of follows) {
    const a = athletes.get(f.athlete_id);
    if (!a) continue;
    const m = resolved.get(a.id)!;
    const c = last.get(a.id);
    const hideContact = a.optedOut; // the player asked not to be contacted
    lines.push([
      a.firstName, a.lastName, a.gradYear, a.primaryPosition, a.secondaryPosition, [a.bats, a.throws].filter(Boolean).join("/"), a.highSchool, a.team, a.city, a.state, a.zip,
      BOARD_LABEL[f.board_status] ?? f.board_status, a.commitmentStatus === "unknown" ? "" : a.commitmentStatus,
      hideContact ? "" : a.email, hideContact ? "" : a.guardianEmail, hideContact ? "" : a.phone, a.xHandle ? `@${a.xHandle}` : "",
      ...metricKeys.flatMap((k) => {
        const r = m.get(k);
        if (!r) return ["", ""];
        const p = r.primary;
        return [METRICS[k].format(p.value), [p.sourceName, p.measuredAt?.slice(0, 10), p.verification].filter(Boolean).join(" · ")];
      }),
      c ? `${CONTACT_KINDS[c.kind]?.label ?? c.kind} ${c.occurred_at.slice(0, 10)}${c.user_name ? ` (${c.user_name})` : ""}` : "",
      (linksBy.get(a.id) ?? []).map((l) => l.url).join(" | "),
      (notesBy.get(a.id) ?? []).map((n) => `${n.created_at.slice(0, 10)}${n.name ? ` ${n.name}` : ""}: ${n.body}`).join(" | "),
      f.created_at.slice(0, 10),
    ].map(csvCell).join(","));
  }
  // BOM so Excel opens accented names correctly.
  return { csv: "﻿" + lines.join("\r\n") + "\r\n", count: lines.length - 1 };
}
