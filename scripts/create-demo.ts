// Builds a branded, clearly-labeled DEMO workspace for a program.
//   npm run demo:create -- demos/palomar.json [password]
// If demos/<name>-logo.(png|svg|jpg|webp) exists next to the config, it becomes the header logo.
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { getDb } from "../src/lib/db";
import { createDemoProgram, type DemoConfig } from "../src/lib/onboarding";

async function main() {
  const cfgPath = process.argv[2];
  if (!cfgPath) throw new Error("Usage: npm run demo:create -- demos/<program>.json [password]");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as DemoConfig;
  cfg.password = process.argv[3] ?? cfg.password ?? "rc-demo-2026";
  const stem = basename(cfgPath, ".json");
  const types: Record<string, string> = { png: "image/png", svg: "image/svg+xml", jpg: "image/jpeg", webp: "image/webp" };
  for (const [ext, mime] of Object.entries(types)) {
    const p = join(dirname(cfgPath), `${stem}-logo.${ext}`);
    if (existsSync(p)) {
      cfg.branding = { ...cfg.branding, logoDataUrl: `data:${mime};base64,${readFileSync(p).toString("base64")}` };
      console.log(`Using logo ${p}`);
      break;
    }
  }
  const db = await getDb();
  const lead = cfg.staff[0];
  if (await db.get("SELECT id FROM users WHERE LOWER(email) = LOWER(?)", [lead.email])) {
    console.log(`A demo for ${lead.email} already exists. Delete data/rc.db (or use a fresh database) to rebuild it.`);
    return;
  }
  await createDemoProgram(db, cfg);
  console.log(`\n${cfg.programName} demo is ready. All players in it are fictional.`);
  console.log("Staff logins (same password for all):");
  for (const s of cfg.staff) console.log(`  ${s.name.padEnd(16)} ${s.title.padEnd(42)} ${s.email}`);
  console.log(`  Password: ${cfg.password}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
