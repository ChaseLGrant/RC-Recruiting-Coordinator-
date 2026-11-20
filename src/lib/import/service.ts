// Import a coach's existing list: read → preview with suggested column
// matches → coach confirms → players land in My Players with their notes,
// board status and any stat-page links (which RC then keeps updated).

import readXlsxFile from "read-excel-file/node";
import { Db, newId, nowIso, parseJson } from "../db";
import { parseCsv } from "../providers/csv";
import { audit, authorize, createSource, getOrg, logEvent, type Ctx } from "../repo";
import { ingestRecords } from "../ingest";
import { applyMapping, googleSheetCsvUrl, guessMapping, type FieldId } from "./mapping";

export const MAX_ROWS = 3000;

export interface TableData { headers: string[]; rows: string[][] }

function tidy(table: unknown[][]): TableData {
  const rows = table.map((r) => r.map((c) => (c == null ? "" : c instanceof Date ? c.toISOString().slice(0, 10) : String(c).trim())));
  // Header = first row with at least two non-empty cells (sheets often have a title row first).
  const hi = rows.findIndex((r) => r.filter(Boolean).length >= 2);
  if (hi < 0) throw new Error("The list looks empty.");
  const headers = rows[hi].map((h, i) => h || `Column ${i + 1}`);
  const body = rows.slice(hi + 1).filter((r) => r.some(Boolean));
  if (body.length === 0) throw new Error("Found column headers but no players under them.");
  if (body.length > MAX_ROWS) throw new Error(`That list has ${body.length} rows. Import up to ${MAX_ROWS} at a time.`);
  return { headers, rows: body.map((r) => headers.map((_, i) => r[i] ?? "")) };
}

export async function readUpload(fileName: string, bytes: Buffer): Promise<TableData> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx")) {
    // Use the first tab that actually has a list on it.
    const sheets = await readXlsxFile(bytes);
    const first = sheets.find((sh) => sh.data.filter((r) => r.some((c) => c != null && String(c).trim())).length >= 2);
    if (!first) throw new Error("That workbook looks empty.");
    return tidy(first.data as unknown[][]);
  }
  if (lower.endsWith(".xls")) throw new Error("Old .xls files aren't supported. In Excel choose File → Save As → .xlsx (or CSV) and upload that.");
  if (lower.endsWith(".csv") || lower.endsWith(".txt") || lower.endsWith(".tsv")) {
    const text = bytes.toString("utf8");
    return tidy(lower.endsWith(".tsv") || (!text.includes(",") && text.includes("\t")) ? text.split(/\r?\n/).map((l) => l.split("\t")) : parseCsv(text));
  }
  throw new Error("Upload a CSV or Excel (.xlsx) file, or paste a Google Sheets link.");
}

export async function readGoogleSheet(link: string, fetchImpl: typeof fetch = fetch): Promise<TableData> {
  const url = googleSheetCsvUrl(link);
  if (!url) throw new Error("That isn't a Google Sheets link. It should look like https://docs.google.com/spreadsheets/d/…");
  let res: Response;
  try {
    res = await fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new Error("Couldn't reach Google Sheets. Try again, or download the sheet as CSV (File → Download → CSV) and upload it.");
  }
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || type.includes("text/html")) {
    throw new Error("That sheet is private. In Google Sheets click Share → General access → \"Anyone with the link\" (Viewer), then paste the link again. Or use File → Download → CSV and upload the file.");
  }
  return tidy(parseCsv(await res.text()));
}

export async function stageImport(ctx: Ctx, listName: string, table: TableData): Promise<string> {
  authorize(ctx, "import_data");
  // Clear this user's stale previews so private list data doesn't linger.
  await ctx.db.run("DELETE FROM pending_imports WHERE org_id = ? AND (user_id = ? OR created_at < ?)", [ctx.orgId, ctx.userId, new Date(Date.now() - 86_400_000).toISOString()]);
  const id = newId();
  await ctx.db.run("INSERT INTO pending_imports (id, org_id, user_id, list_name, headers_json, rows_json, created_at) VALUES (?,?,?,?,?,?,?)", [
    id, ctx.orgId, ctx.userId ?? "system", listName.slice(0, 120), JSON.stringify(table.headers), JSON.stringify(table.rows), nowIso(),
  ]);
  return id;
}

export async function getStagedImport(db: Db, orgId: string, id: string) {
  const r = await db.get<{ id: string; list_name: string; headers_json: string; rows_json: string }>("SELECT * FROM pending_imports WHERE org_id = ? AND id = ?", [orgId, id]);
  if (!r) return null;
  const headers = parseJson<string[]>(r.headers_json, []);
  const rows = parseJson<string[][]>(r.rows_json, []);
  return { id: r.id, listName: r.list_name, headers, rows, suggested: guessMapping(headers, rows.slice(0, 20)) };
}

export interface ImportResult {
  imported: number;
  newPlayers: number;
  matchedExisting: number;
  linksTracked: number;
  notesAdded: number;
  skipped: Array<{ row: number; reason: string }>;
  warnings: string[];
}

export async function confirmImport(ctx: Ctx, id: string, mapping: FieldId[]): Promise<ImportResult> {
  authorize(ctx, "import_data");
  const staged = await getStagedImport(ctx.db, ctx.orgId, id);
  if (!staged) throw new Error("This import expired. Upload the list again.");
  const mapped = applyMapping(staged.headers, staged.rows, mapping, staged.listName);
  if (mapped.rows.length === 0) throw new Error(mapped.warnings[0] ?? "No players could be read from this list.");
  const org = await getOrg(ctx.db, ctx.orgId);
  const source = await createSource(ctx.db, ctx.orgId, {
    providerId: "csv_import", name: `${staged.listName} (your list)`, kind: "import", status: "connected",
    statusDetail: `Imported ${mapped.rows.length} players on ${nowIso().slice(0, 10)}`, attestedBy: ctx.userId,
  });
  let notesAdded = 0;
  const stats = await ingestRecords(ctx.db, ctx.orgId, source, mapped.rows.map((r) => r.record), {
    isDemo: org.isDemo,
    sport: org.sport,
    onAthlete: async (i, athleteId) => {
      const row = mapped.rows[i];
      await ctx.db.run(
        "INSERT INTO follows (id, org_id, athlete_id, user_id, board_status, created_at) VALUES (?,?,?,?,?,?) ON CONFLICT (org_id, athlete_id) DO UPDATE SET board_status = excluded.board_status",
        [newId(), ctx.orgId, athleteId, ctx.userId ?? "system", row.boardStatus, nowIso()],
      );
      if (row.note) {
        const body = `From ${staged.listName}: ${row.note}`;
        const dup = await ctx.db.get("SELECT id FROM notes WHERE org_id = ? AND athlete_id = ? AND body = ?", [ctx.orgId, athleteId, body]);
        if (!dup) {
          await ctx.db.run("INSERT INTO notes (id, org_id, athlete_id, user_id, body, created_at) VALUES (?,?,?,?,?,?)", [newId(), ctx.orgId, athleteId, ctx.userId ?? "system", body, nowIso()]);
          notesAdded++;
        }
      }
    },
  });
  const linksTracked = mapped.rows.reduce((n, r) => n + (r.record.profileUrls?.length ?? 0), 0);
  await ctx.db.run("DELETE FROM pending_imports WHERE id = ?", [id]);
  await logEvent(ctx.db, ctx.orgId, { type: "import_completed", message: `Imported ${mapped.rows.length} players from ${staged.listName}`, sourceId: source.id });
  await audit(ctx, "import_list", "source", source.id, { rows: mapped.rows.length, skipped: mapped.skipped.length });
  return {
    imported: mapped.rows.length,
    newPlayers: stats.athletesCreated,
    matchedExisting: stats.athletesMatched,
    linksTracked,
    notesAdded,
    skipped: mapped.skipped,
    warnings: mapped.warnings,
  };
}
