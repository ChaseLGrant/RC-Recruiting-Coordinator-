// "Snap a roster": a coach takes a photo of a printed roster, a showcase
// program, a lineup card or a handwritten list, and RC reads it into a table.
// The table goes through the normal import preview, so the coach checks every
// row before anything is saved. RC only copies what's written on the page; it
// never fills in anything it can't read.

import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "../db";
import { newId, nowIso } from "../db";
import { AGENT_MODEL, getAgentClient, type AgentClient } from "../agent/crm-agent";
import { MAX_ROWS, type TableData } from "./service";

export const PHOTOS_PER_DAY = () => Math.max(0, Number(process.env.RC_PHOTO_IMPORTS_PER_DAY ?? 40));
const MAX_BYTES = 4_500_000; // the AI's limit is 5 MB per image (after base64, with headroom)
const PRICE = { input: 4, output: 20 }; // $ per million tokens, used for the owner's cost estimate

const SYSTEM = `You transcribe photos of baseball recruiting lists for a college coaching staff: rosters, showcase or tournament programs, lineup cards, spreadsheets on a screen, or handwritten notes.

Rules:
- Copy only what is actually written. Never guess, complete or "fix" a name, number or school. If a cell is unreadable, leave it as an empty string.
- One row per player. Skip coaches, staff, ads, page headers and totals.
- Use the column headings printed on the page when there are any (e.g. "#", "Name", "Pos", "B/T", "Ht", "Wt", "Grad", "HS", "Hometown"). If there are none, use plain headings like "Name", "Position", "Grad year", "School", "Notes".
- If handwritten notes sit next to a player (e.g. "92 FB", "call dad", "follow"), put them in a "Notes" column.
- Keep every row the same length as the headers.
- If the photo doesn't contain a list of players, return no rows and say why in "problem".`;

const SCHEMA = {
  type: "object",
  properties: {
    headers: { type: "array", items: { type: "string" } },
    rows: { type: "array", items: { type: "array", items: { type: "string" } } },
    problem: { type: "string", description: "Empty unless the photo can't be read as a list of players." },
  },
  required: ["headers", "rows", "problem"],
  additionalProperties: false,
} as const;

/** Shrinks big phone photos and converts HEIC/other formats to JPEG so the AI can read them. */
export async function preparePhoto(bytes: Buffer, mediaType: string): Promise<{ data: Buffer; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" }> {
  const ok = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
  if (bytes.length <= MAX_BYTES && (ok as readonly string[]).includes(mediaType)) return { data: bytes, mediaType: mediaType as (typeof ok)[number] };
  try {
    const sharp = (await import("sharp")).default;
    const data = await sharp(bytes).rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    if (data.length > MAX_BYTES) throw new Error("too big");
    return { data, mediaType: "image/jpeg" };
  } catch {
    throw new Error("Couldn't open that photo. Take it again as a regular photo (JPEG or PNG), or take a screenshot of it and upload that.");
  }
}

function parseTable(text: string): { table: TableData | null; problem: string } {
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let raw: { headers?: unknown; rows?: unknown; problem?: unknown };
  try {
    raw = JSON.parse(json);
  } catch {
    return { table: null, problem: "RC couldn't read a list from that photo." };
  }
  const headers = Array.isArray(raw.headers) ? raw.headers.map((h) => String(h ?? "").trim()) : [];
  const rows = (Array.isArray(raw.rows) ? raw.rows : [])
    .filter(Array.isArray)
    .map((r) => headers.map((_, i) => String((r as unknown[])[i] ?? "").trim()))
    .filter((r) => r.some(Boolean));
  const problem = typeof raw.problem === "string" ? raw.problem.trim() : "";
  if (headers.length === 0 || rows.length === 0) return { table: null, problem: problem || "RC didn't find any players in that photo." };
  return { table: { headers: headers.map((h, i) => h || `Column ${i + 1}`), rows: rows.slice(0, MAX_ROWS) }, problem: "" };
}

export async function photosUsedToday(db: Db, orgId: string): Promise<number> {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const r = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM agent_runs WHERE org_id = ? AND status = 'photo_import' AND ran_at >= ?", [orgId, since]);
  return Number(r?.n ?? 0);
}

/** Reads one or more photos of a list into a single table. */
export async function readRosterPhotos(db: Db, orgId: string, photos: Array<{ bytes: Buffer; mediaType: string }>, opts: { client?: AgentClient | null } = {}): Promise<TableData> {
  const client = opts.client === undefined ? getAgentClient() : opts.client;
  if (!client) throw new Error("Photo import isn't switched on yet (RC needs its AI key). Upload a CSV or Excel file instead.");
  if (photos.length === 0) throw new Error("Choose a photo of your list.");
  if (photos.length > 6) throw new Error("Upload up to 6 photos at a time.");
  if ((await photosUsedToday(db, orgId)) + photos.length > PHOTOS_PER_DAY()) throw new Error(`That's the limit of ${PHOTOS_PER_DAY()} photos for today. Try again tomorrow, or upload a CSV.`);

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const [i, p] of photos.entries()) {
    const img = await preparePhoto(p.bytes, p.mediaType);
    if (photos.length > 1) content.push({ type: "text", text: `Photo ${i + 1} of ${photos.length}:` });
    content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data.toString("base64") } });
  }
  content.push({ type: "text", text: photos.length > 1 ? "Transcribe the players from all of these photos into one table (they're pages of the same list)." : "Transcribe the players in this photo into a table." });

  let inTok = 0, outTok = 0;
  let text = "";
  let failed: string | null = null;
  try {
    const resp = await client.beta.messages.create({
      model: AGENT_MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content }],
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);
    inTok = resp.usage.input_tokens ?? 0;
    outTok = resp.usage.output_tokens ?? 0;
    text = resp.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    if (resp.stop_reason === "refusal") failed = "RC couldn't read that photo.";
  } catch (e) {
    failed = "RC couldn't read that photo right now. Try again in a minute, or upload a CSV.";
    console.error("photo import failed", e instanceof Error ? e.message : e);
  }
  const { table, problem } = failed ? { table: null, problem: failed } : parseTable(text);
  const costCents = Math.round(((inTok / 1e6) * PRICE.input + (outTok / 1e6) * PRICE.output) * 10000) / 100;
  // Logged so the owner can see the cost. Photo reads don't count against a school's AI research checks.
  await db.run("INSERT INTO agent_runs (id, org_id, athlete_id, status, updates_proposed, input_tokens, output_tokens, searches, cost_cents, note, ran_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [
    newId(), orgId, "-", "photo_import", table?.rows.length ?? 0, inTok, outTok, 0, costCents, table ? `${photos.length} photo(s), ${table.rows.length} rows` : problem, nowIso(),
  ]);
  if (!table) throw new Error(problem);
  return table;
}
