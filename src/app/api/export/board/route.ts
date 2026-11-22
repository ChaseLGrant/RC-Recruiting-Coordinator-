import { requireSession } from "@/lib/session";
import { audit, authorize } from "@/lib/repo";
import { boardCsv } from "@/lib/export";

export const dynamic = "force-dynamic";

// Always available, subscribed or not: a coach's board is theirs to take.
export async function GET() {
  const { ctx, org } = await requireSession();
  authorize(ctx, "view");
  const { csv, count } = await boardCsv(ctx.db, ctx.orgId);
  await audit(ctx, "export_board", "org", ctx.orgId, { players: count });
  const name = (org.settings.branding.teamName ?? org.name).replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "RC";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}-board-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
