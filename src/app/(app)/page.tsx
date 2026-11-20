import Link from "next/link";
import { requireSession } from "@/lib/session";
import { buildBrief } from "@/lib/services";
import { listMessages } from "@/lib/repo/approvals";
import { listProfiles } from "@/lib/repo";
import { can } from "@/lib/domain/permissions";
import { completeTaskAction, markBriefReviewedAction } from "@/app/actions";
import { ApprovalCard } from "@/components/approval-card";
import { SearchBox } from "@/components/search-box";
import { EXAMPLES } from "@/lib/search-examples";
import { Empty, Flash, timeAgo } from "@/components/ui";
import { encodeCriteria } from "@/lib/criteria-form";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ flash?: string; error?: string }> }) {
  const { ctx, user, org } = await requireSession();
  const sp = await searchParams;
  const brief = await buildBrief(ctx.db, ctx.orgId, user.lastBriefAt);
  const messages = new Map((await listMessages(ctx.db, ctx.orgId)).map((m) => [m.id, m]));
  const profiles = await listProfiles(ctx.db, ctx.orgId);
  const weekAhead = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const gamesThisWeek = await ctx.db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM games g JOIN follows f ON f.athlete_id = g.athlete_id AND f.org_id = g.org_id WHERE g.org_id = ? AND g.starts_at > ? AND g.starts_at < ? AND g.status != 'cancelled'",
    [ctx.orgId, new Date().toISOString(), weekAhead],
  );

  const decidable = (k: string) => (k === "compliance" ? can(user.role, "decide_compliance") : can(user.role, "decide_approvals"));
  const queue = [...brief.pendingApprovals].sort((x, y) => Number(decidable(y.kind)) - Number(decidable(x.kind)));
  const c = brief.counts;
  const highlights = brief.events
    .filter((e) => ["athlete_discovered", "metric_updated", "schedule_changed", "job_failed", "import_completed"].includes(e.type))
    .slice(0, 4);
  const firstName = user.name.split(" ").at(-1) ?? user.name;
  const hasData = brief.events.length > 0 || profiles.length > 0;

  return (
    <div>
      <Flash flash={sp.flash} error={sp.error} />

      {/* Search first: the one thing a coach comes here to do. */}
      <section className="mx-auto max-w-3xl pb-8 pt-2 text-center sm:pt-6">
        <p className="text-sm font-medium text-slate-500">{greeting()}, Coach {firstName}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Who are you looking for?</h1>
        <p className="mx-auto mt-2 max-w-xl text-[15px] text-slate-500">Type it the way you&apos;d say it to an assistant. RC finds the players and shows where every number came from.</p>
        <div className="mt-6 text-left"><SearchBox autoFocus={!hasData} /></div>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {EXAMPLES.map((e) => (
            <Link key={e} href={`/discover?q=${encodeURIComponent(e)}`} className="rounded-full bg-white px-3 py-1.5 text-xs text-slate-600 ring-1 ring-slate-900/10 hover:text-brand-700 hover:ring-brand-500/40">{e}</Link>
          ))}
        </div>
        {profiles.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500">
            <span>Your saved searches:</span>
            {profiles.slice(0, 4).map((p) => <Link key={p.id} href={`/discover?c=${encodeCriteria(p.criteria)}`} className="font-medium text-brand-700 hover:underline">{p.name}</Link>)}
          </div>
        )}
      </section>

      {brief.failedRuns.length > 0 && (
        <div className="mb-6 rounded-2xl bg-rose-50 p-4 text-sm text-rose-900 ring-1 ring-rose-200">
          <b>Something needs a look:</b> {brief.failedRuns.length} background search{brief.failedRuns.length > 1 ? "es" : ""} couldn&apos;t finish. <Link href="/missions" className="underline">See details</Link>
        </div>
      )}

      {/* Three numbers that matter today. */}
      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat href="/approvals?kind=prospect" n={c.athlete_discovered ?? 0} label="new players found for you" sub={user.lastBriefAt ? "since you last checked" : "in the last 24 hours"} />
        <Stat href="/approvals" n={queue.filter((a) => a.status === "pending" && decidable(a.kind)).length} label="waiting on your OK" sub="tap to review" highlight />
        <Stat href="/schedule?days=7" n={Number(gamesThisWeek?.n ?? 0)} label="games this week" sub="for players you follow" />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="lg:col-span-3">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">Needs your OK</h2>
            {queue.length > 4 && <Link href="/approvals" className="text-sm font-medium text-brand-700 hover:underline">See all {queue.length}</Link>}
          </div>
          {queue.length === 0 ? (
            <Empty>You&apos;re all caught up. New players and drafts RC prepares will show up here.</Empty>
          ) : (
            <div className="space-y-3">
              {queue.slice(0, 4).map((a) => (
                <ApprovalCard key={a.id} a={a} message={a.payload.messageId ? messages.get(String(a.payload.messageId)) : undefined} canDecide={can(user.role, "decide_approvals")} canDecideCompliance={can(user.role, "decide_compliance")} />
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-6 lg:col-span-2">
          <section>
            <h2 className="mb-3 text-lg font-semibold">This week</h2>
            <div className="rounded-2xl bg-white p-2 ring-1 ring-slate-900/5">
              {brief.tasks.length === 0 ? <p className="p-3 text-sm text-slate-500">Nothing scheduled. RC adds scouting opportunities here when players you follow have games.</p> : (
                <ul className="divide-y divide-slate-100">
                  {brief.tasks.slice(0, 5).map((t) => (
                    <li key={t.id} className="flex items-start gap-3 p-3 text-sm">
                      <form action={completeTaskAction}><input type="hidden" name="taskId" value={t.id} /><button title="Mark done" aria-label="Mark done" className="mt-0.5 h-5 w-5 rounded-full ring-2 ring-slate-300 hover:bg-emerald-100 hover:ring-emerald-500" /></form>
                      {t.athlete_id ? <Link href={`/athletes/${t.athlete_id}`} className="leading-snug text-slate-700 hover:text-brand-700">{t.title.replace("Scouting opportunity: ", "")}</Link> : <span className="leading-snug">{t.title}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">What RC did</h2>
              <form action={markBriefReviewedAction}><button className="text-sm font-medium text-brand-700 hover:underline">Mark as read</button></form>
            </div>
            <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-900/5">
              <p className="text-sm text-slate-600">
                Checked <b className="text-slate-900">{c.source_checked ?? 0}</b> data sources, reviewed <b className="text-slate-900">{c.athlete_researched ?? 0}</b> player profiles, logged <b className="text-slate-900">{(c.metric_updated ?? 0) + (c.metric_verified ?? 0)}</b> measurements and <b className="text-slate-900">{(c.game_identified ?? 0) + (c.schedule_changed ?? 0)}</b> games.
              </p>
              {highlights.length > 0 ? (
                <ul className="mt-3 space-y-2.5 border-t border-slate-100 pt-3 text-sm">
                  {highlights.map((e) => (
                    <li key={e.id} className="leading-snug">
                      {e.athlete_id ? <Link href={`/athletes/${e.athlete_id}`} className="text-slate-700 hover:text-brand-700">{e.message}</Link> : <span className="text-slate-700">{e.message}</span>}
                      <span className="block text-xs text-slate-400">{timeAgo(e.created_at)}</span>
                    </li>
                  ))}
                </ul>
              ) : !hasData ? (
                <p className="mt-3 text-sm text-slate-500">{org.isDemo ? "Run a search to see RC work." : <>Add your player data in <Link href="/settings#sources" className="underline">Settings</Link>, then search.</>}</p>
              ) : null}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Stat({ href, n, label, sub, highlight }: { href: string; n: number; label: string; sub: string; highlight?: boolean }) {
  return (
    <Link href={href} className={`flex items-center gap-4 rounded-2xl p-4 ring-1 transition sm:p-5 ${highlight && n > 0 ? "bg-brand-900 text-white ring-brand-900 hover:bg-brand-700" : "bg-white ring-slate-900/5 hover:ring-brand-500/40"}`}>
      <span className="text-3xl font-semibold tabular-nums">{n}</span>
      <span className="leading-tight">
        <span className="block text-[15px] font-medium">{label}</span>
        <span className={`block text-xs ${highlight && n > 0 ? "text-blue-200" : "text-slate-500"}`}>{sub}</span>
      </span>
    </Link>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
