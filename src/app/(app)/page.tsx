import Link from "next/link";
import { requireSession } from "@/lib/session";
import { buildBrief } from "@/lib/services";
import { listMessages } from "@/lib/repo/approvals";
import { listProfiles } from "@/lib/repo";
import { can } from "@/lib/domain/permissions";
import { listCandidates } from "@/lib/finder/finder";
import { completeTaskAction, markBriefReviewedAction } from "@/app/actions";
import { ApprovalCard } from "@/components/approval-card";
import { SearchBox } from "@/components/search-box";
import { EXAMPLES } from "@/lib/search-examples";
import { Empty, Flash, timeAgo } from "@/components/ui";
import { encodeCriteria } from "@/lib/criteria-form";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ flash?: string; error?: string; welcome?: string }> }) {
  const { ctx, user, org } = await requireSession();
  const sp = await searchParams;
  const brief = await buildBrief(ctx.db, ctx.orgId, user.lastBriefAt);
  const messages = new Map((await listMessages(ctx.db, ctx.orgId)).map((m) => [m.id, m]));
  const candIds = brief.pendingApprovals.filter((x) => x.kind === "links_found").flatMap((x) => (x.payload.candidateIds as string[]) ?? []);
  const cands = await listCandidates(ctx.db, ctx.orgId, { ids: candIds });
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
  const lastName = user.name.split(" ").at(-1) ?? user.name;
  const hasData = brief.events.length > 0 || profiles.length > 0;

  return (
    <div>
      <Flash flash={sp.flash} error={sp.error} />
      {sp.welcome === "demo" && org.isDemo && (
        <div className="mb-6 border border-slate-900/10 border-t-4 border-t-[var(--team-primary)] bg-white p-5">
          <p className="eyebrow text-slate-500">Welcome, Coach</p>
          <h2 className="font-display text-3xl font-extrabold uppercase leading-none">Try these 3 things</h2>
          <ol className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
            <li><a href="/discover" className="block h-full border border-slate-200 p-3 hover:border-[var(--team-primary)]"><b className="block">1. Find players</b>Type what you need, like &ldquo;2027 shortstops within 100 miles&rdquo;.</a></li>
            <li><a href="/following" className="block h-full border border-slate-200 p-3 hover:border-[var(--team-primary)]"><b className="block">2. Open your board</b>Tap a player to see stats, sources, games, notes and contact log.</a></li>
            <li><a href="/import" className="block h-full border border-slate-200 p-3 hover:border-[var(--team-primary)]"><b className="block">3. Bring your list</b>See how your spreadsheet or a photo of your list comes in.</a></li>
          </ol>
        </div>
      )}

      {/* Search first: the one thing a coach comes here to do. */}
      <section className="relative overflow-hidden bg-[var(--team-ink)] px-5 pb-8 pt-8 text-white sm:px-10 sm:pb-10 sm:pt-12">
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[repeating-linear-gradient(135deg,transparent_0_22px,rgba(255,255,255,0.035)_22px_44px)]" />
        <div className="relative max-w-3xl">
          <p className="eyebrow text-white/60">{greeting()}, Coach {lastName}</p>
          <h1 className="font-display mt-2 text-5xl font-extrabold uppercase leading-[0.9] sm:text-7xl">Who are you<br />looking for?</h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-white/70">Say it the way you&apos;d tell an assistant. RC finds the players and shows where every number came from.</p>
          <div className="mt-6"><SearchBox autoFocus={!hasData} /></div>
          <div className="mt-4 flex flex-wrap gap-2">
            {EXAMPLES.map((e) => (
              <Link key={e} href={`/discover?q=${encodeURIComponent(e)}`} className="border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:border-white/60 hover:text-white">{e}</Link>
            ))}
          </div>
          <p className="mt-4 text-xs text-white/60">Saw someone you like? <Link href="/players/new" className="font-semibold text-white underline decoration-white/30 underline-offset-4">Add a player</Link> · Have a list? <Link href="/import" className="font-semibold text-white underline decoration-white/30 underline-offset-4">Import it</Link></p>
          {profiles.length > 0 && (
            <p className="mt-4 text-xs text-white/60">
              Saved searches:{" "}
              {profiles.slice(0, 4).map((p, i) => <span key={p.id}>{i > 0 && " · "}<Link href={`/discover?c=${encodeCriteria(p.criteria)}`} className="font-semibold text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">{p.name}</Link></span>)}
            </p>
          )}
        </div>
      </section>

      {/* Scoreboard: the three numbers that matter today. */}
      <div className="mb-10 grid grid-cols-1 divide-y divide-slate-900/10 border border-t-0 border-slate-900/10 bg-white sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Stat href="/approvals?kind=prospect" n={c.athlete_discovered ?? 0} label="New players for you" sub={user.lastBriefAt ? "since you last checked" : "last 24 hours"} />
        <Stat href="/approvals" n={queue.filter((a) => a.status === "pending" && decidable(a.kind)).length} label="Waiting on your OK" sub="tap to review" highlight />
        <Stat href="/schedule?days=7" n={Number(gamesThisWeek?.n ?? 0)} label="Games this week" sub="players you follow" />
      </div>

      {brief.failedRuns.length > 0 && (
        <div className="mb-6 border-l-4 border-rose-600 bg-white p-4 text-sm text-rose-900">
          <b>Something needs a look:</b> {brief.failedRuns.length} background search{brief.failedRuns.length > 1 ? "es" : ""} couldn&apos;t finish. <Link href="/missions" className="underline">See details</Link>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="lg:col-span-3">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-display text-2xl font-extrabold uppercase">Needs your OK</h2>
            {queue.length > 4 && <Link href="/approvals" className="text-sm font-medium text-brand-700 hover:underline">See all {queue.length}</Link>}
          </div>
          {queue.length === 0 ? (
            <Empty>You&apos;re all caught up. New players and drafts RC prepares will show up here.</Empty>
          ) : (
            <div className="space-y-3">
              {queue.slice(0, 4).map((a) => (
                <ApprovalCard key={a.id} a={a} message={a.payload.messageId ? messages.get(String(a.payload.messageId)) : undefined} canDecide={can(user.role, "decide_approvals")} canDecideCompliance={can(user.role, "decide_compliance")} candidates={a.kind === "links_found" ? cands.filter((c) => ((a.payload.candidateIds as string[]) ?? []).includes(c.id)) : undefined} />
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-6 lg:col-span-2">
          <section>
            <h2 className="font-display mb-3 text-2xl font-extrabold uppercase">This week</h2>
            <div className="border border-slate-900/10 bg-white p-2">
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
              <h2 className="font-display text-2xl font-extrabold uppercase">What RC did</h2>
              <form action={markBriefReviewedAction}><button className="text-sm font-medium text-brand-700 hover:underline">Mark as read</button></form>
            </div>
            <div className="border border-slate-900/10 bg-white p-4">
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
    <Link href={href} className="group flex items-end justify-between gap-4 px-5 py-4 hover:bg-slate-50">
      <span>
        <span className="eyebrow block text-slate-500">{label}</span>
        <span className="mt-1 block text-xs text-slate-400">{sub}</span>
      </span>
      <span className={`font-display text-6xl font-extrabold leading-none tabular-nums ${highlight && n > 0 ? "text-[var(--team-primary)]" : "text-slate-900"}`}>{n}</span>
    </Link>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
