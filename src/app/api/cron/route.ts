// Scheduler entry point (e.g. Vercel Cron, GitHub Actions, or any cron).
// Runs every mission that is due. Protected by CRON_SECRET.
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runDueMissions } from "@/lib/jobs/runner";
import { runDuePageChecks } from "@/lib/watch/runner";
import { runFinderBatch } from "@/lib/finder/finder";
import { purgeOldGuestDemos } from "@/lib/outreach/cleanup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = await getDb();
  const results = await runDueMissions(db, "cron");
  const pages = await runDuePageChecks(db, 25_000);
  const finder = await runFinderBatch(db, undefined, Date.now() + 15_000);
  const purgedDemos = await purgeOldGuestDemos(db, 20);
  return NextResponse.json({ ran: results.length, results: results.map((r) => ({ runId: r.runId, status: r.status, error: r.error })), statPages: pages, pageFinder: finder, purgedDemos });
}
