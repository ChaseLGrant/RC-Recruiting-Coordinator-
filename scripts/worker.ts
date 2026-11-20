// Background worker: runs due recruiting missions on their schedule.
//   npm run worker            # loop forever (checks every 60s)
//   npm run worker -- --once  # run due missions once and exit (for cron)
import { getDb } from "../src/lib/db";
import { runDueMissions } from "../src/lib/jobs/runner";
import { runDuePageChecks } from "../src/lib/watch/runner";

const once = process.argv.includes("--once");
const intervalMs = Number(process.env.RC_WORKER_INTERVAL_MS ?? 60_000);

async function tick() {
  const db = await getDb();
  const results = await runDueMissions(db, "schedule");
  for (const p of await runDuePageChecks(db)) if (p.checked) console.log(`[worker] ${new Date().toISOString()} stat pages: ${p.checked} checked, ${p.changedStats} stats changed, ${p.problems} problems`);
  for (const r of results) console.log(`[worker] ${new Date().toISOString()} run ${r.runId} ${r.status}${r.error ? `: ${r.error}` : ""}`);
  return results.length;
}

async function main() {
  console.log(`[worker] RC mission worker started (${once ? "single pass" : `every ${intervalMs / 1000}s`})`);
  do {
    try {
      await tick();
    } catch (e) {
      console.error("[worker] tick failed", e);
    }
    if (!once) await new Promise((r) => setTimeout(r, intervalMs));
  } while (!once);
}

main();
