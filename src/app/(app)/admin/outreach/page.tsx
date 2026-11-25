import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { requireSession } from "@/lib/session";
import { isOwner } from "@/lib/billing/schools";
import { listProspects, prospectStatuses, STAGE_LABEL, type Stage } from "@/lib/outreach/prospects";
import { getOrg } from "@/lib/repo";
import { billingState } from "@/lib/billing/plan";
import { adminDeleteProspectAction, adminImportProspectsAction } from "@/app/actions";
import { Badge, Button, Card, Flash, Input, PageHeader, timeAgo } from "@/components/ui";

const ORDER: Stage[] = ["using", "signed_up", "explored", "tried", "clicked", "not_opened"];
const TONE: Record<Stage, "green" | "blue" | "violet" | "amber" | "slate"> = { using: "green", signed_up: "green", explored: "violet", tried: "blue", clicked: "amber", not_opened: "slate" };

// RC owners only: every school you've reached out to, and where each one is.
export default async function OutreachPage({ searchParams }: { searchParams: Promise<{ flash?: string; error?: string; stage?: string; q?: string }> }) {
  const { ctx, user } = await requireSession();
  if (!isOwner(user.email)) notFound();
  const sp = await searchParams;
  const h = await headers();
  const base = (process.env.RC_PUBLIC_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`).replace(/\/$/, "");
  const prospects = await listProspects(ctx.db);
  const st = await prospectStatuses(ctx.db, prospects);
  const counts = Object.fromEntries(ORDER.map((s) => [s, 0])) as Record<Stage, number>;
  for (const p of prospects) counts[st.get(p.id)!.stage]++;
  const q = (sp.q ?? "").toLowerCase();
  const rows = prospects
    .filter((p) => !sp.stage || st.get(p.id)!.stage === sp.stage)
    .filter((p) => !q || `${p.programName} ${p.teamName ?? ""} ${p.conference ?? ""} ${p.coachName ?? ""}`.toLowerCase().includes(q))
    .sort((a, b) => ORDER.indexOf(st.get(a.id)!.stage) - ORDER.indexOf(st.get(b.id)!.stage));
  const plans = new Map<string, string>();
  for (const p of rows) if (p.orgId) plans.set(p.id, billingState(await getOrg(ctx.db, p.orgId)).message);

  return (
    <div>
      <Flash flash={sp.flash} error={sp.error} />
      <PageHeader title="Outreach" subtitle={`${prospects.length} schools · ${counts.tried + counts.explored} trying the demo · ${counts.signed_up + counts.using} signed up`} />
      <p className="-mt-4 mb-6 text-sm"><Link href="/admin" className="text-brand-text underline">← RC owner</Link></p>

      <div className="mb-6 grid grid-cols-3 gap-px border border-slate-900/10 bg-slate-900/10 sm:grid-cols-6">
        {ORDER.map((s) => (
          <Link key={s} href={sp.stage === s ? "/admin/outreach" : `/admin/outreach?stage=${s}`} className={`p-4 ${sp.stage === s ? "bg-slate-900 text-white" : "bg-white hover:bg-slate-50"}`}>
            <div className="font-display text-4xl font-extrabold">{counts[s]}</div>
            <div className={`eyebrow mt-1 ${sp.stage === s ? "text-white/70" : "text-slate-500"}`}>{STAGE_LABEL[s]}</div>
          </Link>
        ))}
      </div>

      <Card title="1 · Add schools" className="mb-6">
        <form action={adminImportProspectsAction} className="flex flex-wrap items-end gap-3">
          <div><Input name="file" type="file" accept=".csv,text/csv" required /></div>
          <Button>Upload school list</Button>
          <a href="/api/admin/prospects?template=1" className="text-sm text-brand-text underline">Download the blank template</a>
        </form>
        <p className="mt-3 text-xs text-slate-500">Columns: Program, Team, ZIP, Primary color, Secondary color, Accent color, Logo URL, Coach, Email, Conference. Only Program and ZIP are required. Colors are hex codes like #c8102e. Upload again any time to add schools or fix colors; existing links keep working.</p>
      </Card>

      <Card title="2 · Send the links" className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <a href="/api/admin/prospects" download className="inline-flex min-h-10 items-center rounded-[3px] bg-brand-600 px-4 py-2 text-[13px] font-bold uppercase tracking-[0.06em] text-on-brand hover:bg-brand-700">Download mail-merge file</a>
          <span className="text-sm text-slate-600">One row per school with the coach&apos;s first name, email and their personal preview link. Works with Gmail mail merge, Mailchimp, Instantly, YAMM and others.</span>
        </div>
      </Card>

      <Card title="3 · See who's interested">
        <form className="mb-4 flex gap-2">
          {sp.stage && <input type="hidden" name="stage" value={sp.stage} />}
          <Input name="q" defaultValue={sp.q} placeholder="Search school, conference or coach" className="max-w-sm" />
          <Button variant="secondary">Search</Button>
        </form>
        {rows.length === 0 ? <p className="text-sm text-slate-500">No schools yet. Upload your list above.</p> : (
          <div className="divide-y divide-slate-100">
            {rows.map((p) => {
              const s = st.get(p.id)!;
              const team = p.teamName ?? p.branding.teamName ?? p.programName;
              return (
                <div key={p.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 py-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center" style={{ background: p.branding.ink }}>
                    {p.branding.logoDataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.branding.logoDataUrl} alt="" className="h-8 w-8 object-contain" />
                    ) : <span className="font-display text-lg font-extrabold" style={{ color: p.branding.primary }}>{team[0]}</span>}
                  </span>
                  <div className="min-w-[14rem] flex-1">
                    <div className="font-semibold">{p.programName}</div>
                    <div className="text-xs text-slate-500">{[p.conference, p.coachName, p.coachEmail].filter(Boolean).join(" · ") || "No coach listed"}</div>
                  </div>
                  <div className="min-w-[12rem] text-xs text-slate-600">
                    <Badge tone={TONE[s.stage]}>{STAGE_LABEL[s.stage]}</Badge>
                    <div className="mt-1">
                      {p.orgId ? <>{s.staff} staff · {s.players} players · {plans.get(p.id)}{s.lastActive ? ` · signed in ${timeAgo(s.lastActive)}` : ""}</>
                        : p.opens > 0 ? <>Demo opened {p.opens}× · {s.demoViews} pages viewed · last {timeAgo(s.demoLastSeen ?? p.lastOpenedAt!)}</>
                        : p.visits > 0 ? <>Link clicked {timeAgo(p.lastVisitAt!)} (may be an email scanner)</>
                        : "Not opened yet"}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <a href={`/p/${p.slug}`} target="_blank" rel="noreferrer" className="font-bold uppercase tracking-wider text-brand-text hover:underline">Preview</a>
                    <input readOnly value={`${base}/p/${p.slug}`} className="w-48 rounded-[3px] border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px]" aria-label={`Preview link for ${p.programName}`} />
                    {!p.orgId && <form action={adminDeleteProspectAction}><input type="hidden" name="id" value={p.id} /><button className="text-slate-400 hover:text-red-600">Remove</button></form>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
