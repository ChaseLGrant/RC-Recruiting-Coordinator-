// Building a demo program touches ~13,000 rows one statement at a time
// (fictional players, observations, games, a real mission run, seeded staff
// activity). Against a hosted Postgres that is ~13,000 network round trips:
// about 40 seconds, during which a coach who tapped "Try RC" saw nothing
// happen. So demos are built in a private in-memory SQLite database (well
// under a second), then shipped to the real database in a handful of
// multi-row INSERTs inside one transaction. Same code, same rows, ~1–2 s.

import { createDb, type Db, type Param, type Row } from "../db";
import { SCHEMA } from "../db/schema";

/** Every table, parents before children, with the column that ties a row to a program. */
export function orgTableOrder(): Array<{ table: string; key: "id" | "org_id" }> {
  const out: Array<{ table: string; key: "id" | "org_id" }> = [];
  for (const sql of SCHEMA) {
    const m = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*)\)/);
    if (!m) continue;
    if (m[1] === "orgs") out.push({ table: "orgs", key: "id" });
    else if (/\borg_id\b/.test(m[2])) out.push({ table: m[1], key: "org_id" });
  }
  return out;
}

const MAX_PARAMS = 30_000; // under both SQLite's (32,766) and Postgres' (65,535) limits
const MAX_ROWS = 500;

/** Copies every row that belongs to `orgId` from `src` into `dst`, in one transaction. Returns rows copied. */
export async function copyOrg(src: Db, dst: Db, orgId: string): Promise<number> {
  const plan: Array<{ table: string; rows: Row[] }> = [];
  for (const { table, key } of orgTableOrder()) {
    const rows = await src.all<Row>(`SELECT * FROM ${table} WHERE ${key} = ?`, [orgId]);
    if (rows.length) plan.push({ table, rows });
  }
  let copied = 0;
  await dst.tx(async (tx) => {
    for (const { table, rows } of plan) {
      const cols = Object.keys(rows[0]);
      const per = Math.max(1, Math.min(MAX_ROWS, Math.floor(MAX_PARAMS / cols.length)));
      for (let i = 0; i < rows.length; i += per) {
        const chunk = rows.slice(i, i + per);
        const tuple = `(${cols.map(() => "?").join(",")})`;
        const params: Param[] = [];
        for (const r of chunk) for (const c of cols) params.push(toParam(r[c]));
        await tx.run(`INSERT INTO ${table} (${cols.join(",")}) VALUES ${chunk.map(() => tuple).join(",")}`, params);
        copied += chunk.length;
      }
    }
  });
  return copied;
}

function toParam(v: unknown): Param {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  return String(v);
}

export type BuildMode = "direct" | "memory";

/**
 * Runs `build` (which creates one program and returns its id) as fast as the
 * database allows. Local SQLite is already fast, so it builds in place. On
 * Postgres it builds in memory and copies the result over. If the in-memory
 * database can't start, it falls back to building in place (slow but correct).
 */
export async function buildFast<T extends { orgId: string }>(
  db: Db,
  build: (db: Db) => Promise<T>,
  opts: { forceMemory?: boolean } = {},
): Promise<T & { mode: BuildMode }> {
  const useMemory = opts.forceMemory || db.driver === "postgres";
  if (!useMemory) return { ...(await build(db)), mode: "direct" };
  let mem: Db;
  try {
    mem = await createDb({ sqliteOnly: true, sqlitePath: ":memory:" });
  } catch (e) {
    console.warn("[rc] in-memory demo build unavailable, building in place:", e instanceof Error ? e.message : e);
    return { ...(await build(db)), mode: "direct" };
  }
  try {
    const out = await build(mem);
    await copyOrg(mem, db, out.orgId);
    return { ...out, mode: "memory" };
  } finally {
    await mem.close().catch(() => {});
  }
}
