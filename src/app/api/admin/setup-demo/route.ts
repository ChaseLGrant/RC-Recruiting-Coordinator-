// One-time setup on a live deployment: builds a branded demo program from
// demos/<name>.json (and demos/<name>-logo.* if present).
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" "https://<your-site>/api/admin/setup-demo?name=palomar&password=<staff-password>"
import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getDb } from "@/lib/db";
import { createDemoProgram, type DemoConfig } from "@/lib/onboarding";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const name = (url.searchParams.get("name") ?? "palomar").replace(/[^a-z0-9_-]/gi, "");
  const password = url.searchParams.get("password") ?? "";
  if (password.length < 8) return NextResponse.json({ error: "Add ?password= with at least 8 characters (this becomes the staff login password)." }, { status: 400 });
  const dir = path.join(process.cwd(), "demos");
  const cfgPath = path.join(dir, `${name}.json`);
  if (!existsSync(cfgPath)) return NextResponse.json({ error: `demos/${name}.json not found` }, { status: 404 });
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as DemoConfig;
  cfg.password = password;
  for (const [ext, mime] of [["png", "image/png"], ["svg", "image/svg+xml"], ["jpg", "image/jpeg"], ["webp", "image/webp"]]) {
    const p = path.join(dir, `${name}-logo.${ext}`);
    if (existsSync(p)) {
      cfg.branding = { ...cfg.branding, logoDataUrl: `data:${mime};base64,${readFileSync(p).toString("base64")}` };
      break;
    }
  }
  const db = await getDb();
  const login = cfg.sharedLogin?.email ?? cfg.staff[0].email ?? "";
  if (await db.get("SELECT id FROM users WHERE LOWER(email) = LOWER(?)", [login])) {
    return NextResponse.json({ ok: true, alreadyExists: true, login });
  }
  await createDemoProgram(db, cfg);
  return NextResponse.json({ ok: true, login, staff: cfg.staff.map((s) => s.name), note: "All players in this demo are fictional." });
}
