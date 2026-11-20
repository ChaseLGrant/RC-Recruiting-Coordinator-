// Scheduler entry point (e.g. Vercel Cron, GitHub Actions, or any cron).
// Runs every mission that is due. Protected by CRON_SECRET.
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runDueMissions } from "@/lib/jobs/runner";
import { runDuePageChecks } from "@/lib/watch/runner";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = await getDb();
  const results = await runDueMissions(db, "cron");
  const pages = await runDuePageChecks(db);
  return NextResponse.json({ ran: results.length, results: results.map((r) => ({ runId: r.runId, status: r.status, error: r.error })), statPages: pages });
}
