import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { getOrg } from "@/lib/repo";
import { aiAccess } from "@/lib/agent/entitlement";
import { adminSetAddonAction } from "@/app/actions";
import { Badge, Button, Flash, Input, PageHeader, timeAgo } from "@/components/ui";

// RC owners only (emails listed in RC_ADMIN_EMAILS). Schools never see this page.
export default async function AdminPage({ searchParams }: { searchParams: Promise<{ flash?: string; error?: string }> }) {
  const { ctx, user } = await requireSession();
  const owners = (process.env.RC_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!owners.includes(user.email.toLowerCase())) notFound();
  const sp = await searchParams;
  const orgs = await ctx.db.all<{ id: string; name: string; is_demo: number; created_at: string }>("SELECT id, name, is_demo, created_at FROM orgs ORDER BY created_at DESC");
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const rows = await Promise.all(orgs.map(async (o) => {
    const org = await getOrg(ctx.db, o.id);
    const access = await aiAccess(ctx.db, org);
    const players = await ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM follows WHERE org_id = ?", [o.id]);
    const spend = await ctx.db.get<{ c: number }>("SELECT COALESCE(SUM(cost_cents), 0) AS c FROM agent_runs WHERE org_id = ? AND ran_at >= ?", [o.id, monthStart.toISOString()]);
    const staff = await ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE org_id = ? AND is_shared = 0", [o.id]);
    return { o, org, access, players: Number(players?.n ?? 0), cents: Number(spend?.c ?? 0), staff: Number(staff?.n ?? 0) };
  }));
  const requests = rows.filter((r) => r.org.settings.plan.requestedAt && !r.org.settings.plan.aiResearch);
  const totalCents = rows.reduce((s, r) => s + r.cents, 0);
  return (
    <div>
      <Flash flash={sp.flash} error={sp.error} />
      <PageHeader title="RC owner" subtitle={`${orgs.length} programs · ${rows.filter((r) => r.org.settings.plan.aiResearch).length} with AI research · about $${(totalCents / 100).toFixed(2)} AI usage this month (estimate)`} />
      {requests.length > 0 && (
        <div className="mb-6 border-l-4 border-[var(--team-primary)] bg-white p-4 text-sm">
          <b>{requests.length} program{requests.length > 1 ? "s" : ""} asked for AI research:</b> {requests.map((r) => `${r.org.name} (${timeAgo(r.org.settings.plan.requestedAt)})`).join(", ")}
        </div>
      )}
      <div className="space-y-3">
        {rows.map(({ o, org, access, players, cents, staff }) => (
          <div key={o.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 border border-slate-900/10 bg-white p-4">
            <div className="min-w-[14rem] flex-1">
              <div className="font-semibold">{o.name} {o.is_demo ? <Badge tone="violet">demo</Badge> : null}</div>
              <div className="text-xs text-slate-500">{staff} staff · {players} players on board · joined {timeAgo(o.created_at)}</div>
            </div>
            <div className="text-sm">
              {org.settings.plan.aiResearch ? <Badge tone="green">AI research on</Badge> : <Badge>{access.mode === "trial" ? `Trial: ${access.trialTotal - access.trialUsed} left` : "Free plan"}</Badge>}
              <div className="mt-1 text-xs text-slate-500">{access.usedThisMonth} checks this month · ${(cents / 100).toFixed(2)}</div>
            </div>
            <form action={adminSetAddonAction} className="flex items-center gap-2">
              <input type="hidden" name="orgId" value={o.id} />
              <input type="hidden" name="on" value={org.settings.plan.aiResearch ? "0" : "1"} />
              <label className="text-xs text-slate-500">Checks/month <Input name="limit" type="number" min={1} defaultValue={org.settings.plan.aiMonthlyLimit} className="w-20" /></label>
              <Button variant={org.settings.plan.aiResearch ? "secondary" : "primary"}>{org.settings.plan.aiResearch ? "Turn off" : "Turn on"}</Button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
