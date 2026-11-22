import { requireSession } from "@/lib/session";
import { isOwner } from "@/lib/billing/schools";
import { listProspects, mailMergeCsv, prospectStatuses } from "@/lib/outreach/prospects";

export const dynamic = "force-dynamic";

const TEMPLATE = "﻿Program,Team,ZIP,Primary color,Secondary color,Accent color,Logo URL,Coach,Email,Conference\r\nExample College Baseball,Example Baseball,92069,#c8102e,#141414,#a7a9ac,https://example.edu/logo.png,Coach Jane Smith,jsmith@example.edu,Example Conference\r\n";

// Owner only. ?template=1 gives a blank school list; otherwise the mail-merge file.
export async function GET(req: Request) {
  const { ctx, user } = await requireSession();
  if (!isOwner(user.email)) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  if (url.searchParams.get("template")) {
    return new Response(TEMPLATE, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="rc-school-list-template.csv"' } });
  }
  const base = (process.env.RC_PUBLIC_URL ?? `${req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "")}://${req.headers.get("host")}`).replace(/\/$/, "");
  const prospects = await listProspects(ctx.db);
  const csv = mailMergeCsv(prospects, base, await prospectStatuses(ctx.db, prospects));
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="rc-mail-merge-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
}
