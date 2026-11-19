// Permitted CSV imports: data the program is authorized to use (its own
// evaluations, camp results, licensed exports). The importing coach attests
// to that right, and every row is stamped with the import as its source.

import { METRIC_KEYS } from "../domain/metrics";
import { parseHeight } from "../domain/metrics";
import type { Verification } from "../domain/types";
import type { ProviderAthleteRecord } from "./types";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export const ATHLETE_CSV_COLUMNS = [
  "first_name", "last_name", "grad_year", "primary_position", "secondary_position", "high_school", "team", "city", "state", "zip",
  "email", "guardian_email", "commitment_status", "commitment_verified", "external_id", "measured_at", "verification", "source_url", "event_name", "film_url",
  ...METRIC_KEYS, "height",
];

export const SCHEDULE_CSV_COLUMNS = ["first_name", "last_name", "grad_year", "team", "opponent", "venue", "city", "state", "starts_at", "source_url", "external_id"];

const VERIFICATIONS: Verification[] = ["independently_verified", "official", "self_reported", "unverified"];

export interface CsvParseResult {
  records: ProviderAthleteRecord[];
  errors: string[];
}

function normHeader(h: string) {
  return h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function cleanDate(v: string | undefined): string | null {
  if (!v || !v.trim()) return null;
  const t = Date.parse(v.trim());
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

export function parseAthleteCsv(text: string): CsvParseResult {
  const rows = parseCsv(text);
  const errors: string[] = [];
  if (rows.length < 2) return { records: [], errors: ["The file has no data rows."] };
  const headers = rows[0].map(normHeader);
  if (!headers.includes("first_name") || !headers.includes("last_name")) {
    return { records: [], errors: ["Missing required columns: first_name and last_name."] };
  }
  const records: ProviderAthleteRecord[] = [];
  rows.slice(1).forEach((cells, idx) => {
    const line = idx + 2;
    const get = (k: string) => {
      const i = headers.indexOf(k);
      return i >= 0 ? (cells[i] ?? "").trim() : "";
    };
    const first = get("first_name");
    const last = get("last_name");
    if (!first || !last) {
      errors.push(`Row ${line}: missing first or last name — skipped.`);
      return;
    }
    const grad = get("grad_year") ? Number(get("grad_year")) : null;
    if (grad != null && (!Number.isInteger(grad) || grad < 2020 || grad > 2040)) errors.push(`Row ${line}: grad_year "${get("grad_year")}" ignored.`);
    let verification = (get("verification") || "unverified").toLowerCase().replace(/[\s-]+/g, "_") as Verification;
    if (!VERIFICATIONS.includes(verification)) {
      errors.push(`Row ${line}: unknown verification "${get("verification")}" — recorded as unverified.`);
      verification = "unverified";
    }
    const measuredAt = cleanDate(get("measured_at"));
    const metrics: NonNullable<ProviderAthleteRecord["metrics"]> = [];
    for (const key of METRIC_KEYS) {
      const raw = get(key);
      if (!raw) continue;
      const v = key === "height_in" ? parseHeight(raw) ?? Number(raw) : Number(raw);
      if (!Number.isFinite(v)) {
        errors.push(`Row ${line}: ${key} "${raw}" is not a number — skipped.`);
        continue;
      }
      metrics.push({ key, value: v, measuredAt, verification, sourceUrl: get("source_url") || null, eventName: get("event_name") || null });
    }
    if (get("height") && !get("height_in")) {
      const h = parseHeight(get("height"));
      if (h) metrics.push({ key: "height_in", value: h, measuredAt, verification, sourceUrl: get("source_url") || null, eventName: get("event_name") || null });
      else errors.push(`Row ${line}: height "${get("height")}" not understood — skipped.`);
    }
    const commit = get("commitment_status").toLowerCase();
    records.push({
      externalId: get("external_id") || null,
      firstName: first,
      lastName: last,
      gradYear: grad != null && Number.isInteger(grad) && grad >= 2020 && grad <= 2040 ? grad : null,
      primaryPosition: get("primary_position").toUpperCase() || null,
      secondaryPosition: get("secondary_position").toUpperCase() || null,
      highSchool: get("high_school") || null,
      team: get("team") || null,
      city: get("city") || null,
      state: get("state").toUpperCase() || null,
      zip: get("zip") || null,
      email: get("email") || null,
      guardianEmail: get("guardian_email") || null,
      commitmentStatus: commit === "committed" ? "committed" : commit === "uncommitted" ? "uncommitted" : "unknown",
      commitmentVerified: /^(true|yes|1|y)$/i.test(get("commitment_verified")),
      metrics,
      film: get("film_url") ? [{ url: get("film_url"), title: null, recordedAt: measuredAt }] : [],
    });
  });
  return { records, errors };
}

export function parseScheduleCsv(text: string): CsvParseResult {
  const rows = parseCsv(text);
  const errors: string[] = [];
  if (rows.length < 2) return { records: [], errors: ["The file has no data rows."] };
  const headers = rows[0].map(normHeader);
  for (const req of ["first_name", "last_name", "starts_at"]) if (!headers.includes(req)) return { records: [], errors: [`Missing required column: ${req}.`] };
  const byAthlete = new Map<string, ProviderAthleteRecord>();
  rows.slice(1).forEach((cells, idx) => {
    const get = (k: string) => {
      const i = headers.indexOf(k);
      return i >= 0 ? (cells[i] ?? "").trim() : "";
    };
    const t = Date.parse(get("starts_at"));
    if (Number.isNaN(t)) {
      errors.push(`Row ${idx + 2}: starts_at "${get("starts_at")}" is not a date — skipped.`);
      return;
    }
    const key = `${get("first_name")}|${get("last_name")}|${get("grad_year")}`.toLowerCase();
    const rec = byAthlete.get(key) ?? {
      firstName: get("first_name"), lastName: get("last_name"), gradYear: get("grad_year") ? Number(get("grad_year")) : null, team: get("team") || null, games: [],
    };
    rec.games!.push({
      externalId: get("external_id") || null, teamName: get("team") || null, opponent: get("opponent") || null, venue: get("venue") || null,
      city: get("city") || null, state: get("state").toUpperCase() || null, startsAt: new Date(t).toISOString(), sourceUrl: get("source_url") || null,
    });
    byAthlete.set(key, rec);
  });
  return { records: Array.from(byAthlete.values()), errors };
}
