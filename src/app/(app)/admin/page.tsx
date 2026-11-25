import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { getOrg } from "@/lib/repo";
import { isOwner } from "@/lib/billing/schools";
import { billingEnforced, billingState } from "@/lib/billing/plan";
import { adminBillingAction, adminCreateSchoolAction, adminNewInviteAction } from "@/app/actions";
import { Badge, Button, Card, Flash, Input, Label, PageHeader, timeAgo } from "@/components/ui";

// RC owners only (emails in RC_ADMIN_EMAILS). Schools never see this page.
export default async function AdminPage({ searchParams }: { searchParams: Promise<{ flash?: string; error?: string }> }) {
  const { ctx, user } = await requireSession({ allowInactive: true });
  if (!isOwner(user.email)) notFound();
  const sp = await searchParams;
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  // Throwaway try-it demos are tracked on the Outreach page, not here.
  const orgs = await ctx.db.all<{ id: string; created_at: string }>("SELECT id, created_at FROM orgs WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.org_id = orgs.id AND u.email LIKE '%@guest.rc.local') ORDER BY created_at DESC");
  const rows = await Promise.all(orgs.map(async (o) => {
    const org = await getOrg(ctx.db, o.id);
    const n = await ctx.db.get<{ players: number; staff: number; checks: number; cents: number; invited: number }>(
      `SELECT (SELECT COUNT(*) FROM follows WHERE org_id = ?) AS players,
              (SELECT COUNT(*) FROM users WHERE org_id = ? AND is_shared = 0) AS staff,
              (SELECT COUNT(*) FROM agent_runs WHERE org_id = ? AND ran_at >= ?) AS checks,
              (SELECT COALESCE(SUM(cost_cents), 0) FROM agent_runs WHERE org_id = ? AND ran_at >= ?) AS cents,
              (SELECT COUNT(*) FROM invites WHERE org_id = ? AND used_at IS NULL AND expires_at > ?) AS invited`,
      [o.id, o.id, o.id, monthStart.toISOString(), o.id, monthStart.toISOString(), o.id, new Date().toISOString()],
    );
    return { org, created: o.created_at, state: billingState(org), n };
  }));
  const paying = rows.filter((r) => ["active", "invoice"].includes(r.state.reason)).length;
  const trials = rows.filter((r) => r.state.reason === "trialing").length;
  const aiDollars = rows.reduce((s, r) => s + Number(r.n?.cents ?? 0), 0) / 100;
  return (
    <div>
      <Flash flash={sp.flash} error={sp.error} />
      <p className="mb-4"><a href="/admin/outreach" className="inline-flex min-h-10 items-center rounded-[3px] bg-brand-600 px-4 py-2 text-[13px] font-bold uppercase tracking-[0.06em] text-on-brand hover:bg-brand-700">Outreach: schools, demo links & who&apos;s interested →</a></p>
      <PageHeader title="RC owner" subtitle={`${rows.length} programs · ${paying} paying · ${trials} in trial · about $${aiDollars.toFixed(2)} AI usage this month (estimate)${billingEnforced() ? "" : " · Stripe not connected yet (everything is open)"}`} />

      <Card title="Add a school" className="mb-6">
        <form action={adminCreateSchoolAction} className="grid gap-3 sm:grid-cols-2">
          <div><Label>Program name</Label><Input name="programName" required placeholder="Palomar College Baseball" /></div>
          <div><Label>Team name in the header</Label><Input name="teamName" placeholder="Palomar Baseball" /></div>
          <div><Label>Campus ZIP</Label><Input name="campusZip" required placeholder="92069" /></div>
          <div><Label>Logo (PNG, JPG, WebP or SVG)</Label><Input name="logo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" /></div>
          <div className="flex gap-3 sm:col-span-2">
            <label className="text-xs font-medium text-slate-600">Main color<input name="primary" type="color" defaultValue="#c8102e" className="mt-1 block h-10 w-16 border border-slate-200" /></label>
            <label className="text-xs font-medium text-slate-600">Header<input name="ink" type="color" defaultValue="#141414" className="mt-1 block h-10 w-16 border border-slate-200" /></label>
            <label className="text-xs font-medium text-slate-600">Accent<input name="accent" type="color" defaultValue="#a7a9ac" className="mt-1 block h-10 w-16 border border-slate-200" /></label>
          </div>
          <div className="sm:col-span-2"><Button>Create school & get invite link</Button></div>
        </form>
      </Card>

      <div className="space-y-3">
        {rows.map(({ org, created, state, n }) => (
          <div key={org.id} className="border border-slate-900/10 bg-white p-4">
            <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
              <div className="min-w-[14rem] flex-1">
                <div className="font-semibold">{org.name} {org.isDemo && <Badge tone="violet">demo</Badge>}</div>
                <div className="text-xs text-slate-500">{n?.staff ?? 0} staff · {n?.players ?? 0} players · joined {timeAgo(created)}{Number(n?.invited ?? 0) > 0 ? " · invite pending" : ""}</div>
              </div>
              <div className="text-sm">
                <Badge tone={state.active ? (state.reason === "trialing" ? "blue" : "green") : "amber"}>{state.message}</Badge>
                <div className="mt-1 text-xs text-slate-500">AI: {n?.checks ?? 0} checks this month · ${(Number(n?.cents ?? 0) / 100).toFixed(2)}</div>
              </div>
              <form action={adminNewInviteAction}><input type="hidden" name="orgId" value={org.id} /><button className="text-xs font-bold uppercase tracking-wider text-brand-text hover:underline">New invite link</button></form>
            </div>
            <form action={adminBillingAction} className="mt-3 flex flex-wrap items-end gap-4 border-t border-slate-100 pt-3 text-sm">
              <input type="hidden" name="orgId" value={org.id} />
              <label className="flex items-center gap-2"><input type="checkbox" name="comp" value="1" defaultChecked={org.settings.plan.comp} /> Complimentary</label>
              <label className="text-xs text-slate-500">Paid by invoice through<Input name="paidThrough" type="date" defaultValue={org.settings.plan.paidThrough?.slice(0, 10) ?? ""} className="mt-1 w-40" /></label>
              <label className="text-xs text-slate-500">AI checks / month<Input name="aiMonthlyLimit" type="number" min={0} defaultValue={org.settings.plan.aiMonthlyLimit} className="mt-1 w-24" /></label>
              <Button variant="secondary" className="text-xs">Save</Button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
