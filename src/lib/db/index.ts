// Database adapter. One async interface, two drivers:
//   - SQLite via Node's built-in `node:sqlite` (default; zero setup)
//   - PostgreSQL / Supabase via `pg` when DATABASE_URL is set
// SQL is written with `?` placeholders; the pg driver rewrites them to $1..$n.

import { COLUMN_MIGRATIONS, SCHEMA } from "./schema";

export type Row = Record<string, unknown>;
export type Param = string | number | null;

export interface Db {
  all<T = Row>(sql: string, params?: Param[]): Promise<T[]>;
  get<T = Row>(sql: string, params?: Param[]): Promise<T | undefined>;
  run(sql: string, params?: Param[]): Promise<{ changes: number }>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  driver: "sqlite" | "postgres";
}

async function createSqlite(path: string): Promise<Db> {
  // Suppress the one-time ExperimentalWarning for node:sqlite.
  const originalEmit = process.emitWarning;
  process.emitWarning = ((w: unknown, ...rest: unknown[]) => {
    if (String(w).includes("SQLite")) return;
    return (originalEmit as (...a: unknown[]) => void).call(process, w, ...rest);
  }) as typeof process.emitWarning;
  const { DatabaseSync } = await import("node:sqlite");
  process.emitWarning = originalEmit;

  if (path !== ":memory:") {
    const fs = await import("node:fs");
    const p = await import("node:path");
    fs.mkdirSync(p.dirname(p.resolve(path)), { recursive: true });
  }
  const conn = new DatabaseSync(path);
  conn.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  let depth = 0;
  const db: Db = {
    driver: "sqlite",
    async all<T>(sql: string, params: Param[] = []) {
      return conn.prepare(sql).all(...params) as T[];
    },
    async get<T>(sql: string, params: Param[] = []) {
      return conn.prepare(sql).get(...params) as T | undefined;
    },
    async run(sql: string, params: Param[] = []) {
      const r = conn.prepare(sql).run(...params);
      return { changes: Number(r.changes) };
    },
    async tx<T>(fn: (db: Db) => Promise<T>) {
      if (depth > 0) return fn(db);
      depth++;
      conn.exec("BEGIN");
      try {
        const out = await fn(db);
        conn.exec("COMMIT");
        return out;
      } catch (e) {
        conn.exec("ROLLBACK");
        throw e;
      } finally {
        depth--;
      }
    },
    async close() {
      conn.close();
    },
  };
  return db;
}

function toPg(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function createPostgres(url: string): Promise<Db> {
  const { Pool } = await import("pg");
  // Hosted Postgres (Supabase/Neon via Vercel) adds ?sslmode=… to the URL; newer
  // pg versions treat that as strict certificate checking, which fails behind
  // poolers. RC sets TLS itself instead.
  const local = /localhost|127\.0\.0\.1/.test(url);
  const clean = url.replace(/([?&])(sslmode|supa|pgbouncer)=[^&]*&?/g, "$1").replace(/[?&]$/, "");
  const pool = new Pool({ connectionString: clean, max: 5, ssl: local ? undefined : { rejectUnauthorized: false } });
  type Client = { query: (s: string, p?: Param[]) => Promise<{ rows: Row[]; rowCount: number | null }> };
  const make = (client: Client, inTx: boolean): Db => ({
    driver: "postgres",
    async all<T>(sql: string, params: Param[] = []) {
      return (await client.query(toPg(sql), params)).rows as T[];
    },
    async get<T>(sql: string, params: Param[] = []) {
      return (await client.query(toPg(sql), params)).rows[0] as T | undefined;
    },
    async run(sql: string, params: Param[] = []) {
      const r = await client.query(toPg(sql), params);
      return { changes: r.rowCount ?? 0 };
    },
    async tx<T>(fn: (db: Db) => Promise<T>) {
      if (inTx) return fn(make(client, true));
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const out = await fn(make(c as unknown as Client, true));
        await c.query("COMMIT");
        return out;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    },
    async close() {
      if (!inTx) await pool.end();
    },
  });
  return make(pool as unknown as Client, false);
}

export async function createDb(opts?: { url?: string; sqlitePath?: string }): Promise<Db> {
  // DATABASE_URL, or POSTGRES_URL as set by Vercel's Supabase/Neon integrations.
  const url = opts?.url ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  const db = url
    ? await createPostgres(url)
    : await createSqlite(opts?.sqlitePath ?? process.env.RC_SQLITE_PATH ?? "./data/rc.db");
  for (const stmt of SCHEMA) await db.run(stmt);
  for (const stmt of COLUMN_MIGRATIONS) {
    try {
      await db.run(stmt);
    } catch {
      /* column already exists */
    }
  }
  if (db.driver === "postgres") {
    // Supabase also exposes tables through its public API. RC never uses that API, so lock
    // every RC table to it (row-level security on, no policies). RC's own server connection
    // is the table owner and is unaffected.
    for (const stmt of SCHEMA) {
      const t = stmt.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1];
      if (t) await db.run(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
    }
  }
  return db;
}

// Singleton for the app/worker process (survives Next.js dev hot reloads).
const g = globalThis as unknown as { __rcDb?: Promise<Db> };
export function getDb(): Promise<Db> {
  if (!g.__rcDb) g.__rcDb = createDb();
  return g.__rcDb;
}

export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseJson<T>(s: unknown, fallback: T): T {
  if (typeof s !== "string") return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
