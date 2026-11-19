import Link from "next/link";
import { requireSession } from "@/lib/session";
import { listAthletes, listFollows, listObservations } from "@/lib/repo";
import { resolveAll } from "@/lib/domain/provenance";
import { nextGames } from "@/lib/services";
import { toggleFollowAction } from "@/app/actions";
import { Badge, Empty, Flash, PageHeader, Select, fmtDate, timeAgo } from "@/components/ui";
import { DemoTag, MetricValue } from "@/components/evidence";

const BOARD_STATUSES = ["watching", "evaluating", "priority", "contacted", "not_a_fit"];

export default async function FollowingPage({ searchParams }: { searchParams: Promise<{ flash?: string; error?: string; status?: string }> }) {
  const { ctx } = await requireSession();
  const sp = await searchParams;
  const follows = await listFollows(ctx.db, ctx.orgId);
  const ids = follows.map((f) => f.athlete_id);
  const athletes = new Map((await listAthletes(ctx.db, ctx.orgId, { ids })).map((a) => [a.id, a]));
  const obs = await listObservations(ctx.db, ctx.orgId, ids);
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const changes = ids.length
    ? await ctx.db.all<{ athlete_id: string; message: string; created_at: string; type: string }>(
        `SELECT athlete_id, message, created_at, type FROM events WHERE org_id = ? AND created_at > ? AND type IN ('metric_updated','schedule_changed','conflict_detected') AND athlete_id IN (${ids.map(() => "?").join(",")}) ORDER BY created_at DESC`,
        [ctx.orgId, since, ...ids],
      )
    : [];
  const nextGame = await nextGames(ctx.db, ctx.orgId, ids);
  const rows = follows.filter((f) => !sp.status || f.board_status === sp.status);

  return (
    <div>
      <Flash flash={sp.flash} error={sp.error} />
      <PageHeader title="Following" subtitle="Your recruiting board. RC monitors these athletes' sources and schedules and reports changes in your Daily Brief." actions={ids.length > 1 ? <form method="get" action="/compare">{ids.slice(0, 4).map((i) => <input key={i} type="hidden" name="ids" value={i} />)}<button className="rounded-lg bg-white px-3 py-1.5 text-sm ring-1 ring-slate-300">Compare top {Math.min(4, ids.length)}</button></form> : undefined} />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Link href="/following" className={`rounded-full px-3 py-1 ${!sp.status ? "bg-brand-600 text-white" : "bg-white ring-1 ring-slate-200"}`}>All ({follows.length})</Link>
        {BOARD_STATUSES.map((s) => <Link key={s} href={`/following?status=${s}`} className={`rounded-full px-3 py-1 ${sp.status === s ? "bg-brand-600 text-white" : "bg-white ring-1 ring-slate-200"}`}>{s.replace(/_/g, " ")} ({follows.filter((f) => f.board_status === s).length})</Link>)}
      </div>
      {rows.length === 0 ? <Empty>No athletes here yet. Follow prospects from <Link href="/discover" className="underline">Discover</Link> or approve RC&apos;s recommendations on Home.</Empty> : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Athlete</th><th className="px-3 py-2">Board</th><th className="px-3 py-2">Height</th><th className="px-3 py-2">Weight</th><th className="px-3 py-2">Exit velo</th><th className="px-3 py-2">60 yd</th><th className="px-3 py-2">Next game</th><th className="px-3 py-2">Changes (14 days)</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((f) => {
                const a = athletes.get(f.athlete_id);
                if (!a) return null;
                const m = resolveAll(obs.filter((o) => o.athleteId === a.id));
                const ch = changes.filter((c) => c.athlete_id === a.id);
                const g = nextGame.get(a.id);
                return (
                  <tr key={f.athlete_id}>
                    <td className="px-3 py-2"><Link href={`/athletes/${a.id}`} className="font-medium hover:underline">{a.firstName} {a.lastName}</Link> {a.isDemo && <DemoTag />}<div className="text-xs text-slate-500">{a.primaryPosition} · {a.gradYear} · {a.city}, {a.state}</div></td>
                    <td className="px-3 py-2">
                      <form action={toggleFollowAction} className="flex gap-1">
                        <input type="hidden" name="athleteId" value={a.id} /><input type="hidden" name="follow" value="1" /><input type="hidden" name="returnTo" value="/following" />
                        <Select name="boardStatus" defaultValue={f.board_status}>{BOARD_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</Select>
                        <button className="text-xs text-brand-600">Save</button>
                      </form>
                      <form action={toggleFollowAction}><input type="hidden" name="athleteId" value={a.id} /><input type="hidden" name="follow" value="0" /><input type="hidden" name="returnTo" value="/following" /><button className="text-xs text-slate-400 hover:text-rose-600">Unfollow</button></form>
                    </td>
                    {["height_in", "weight_lb", "exit_velo_mph", "sixty_yd_sec"].map((k) => <td key={k} className="px-3 py-2"><MetricValue m={m.get(k)} compact /></td>)}
                    <td className="px-3 py-2 text-xs">{g ? <>{fmtDate(g.starts_at, { month: "short", day: "numeric" })}<div className="text-slate-500">vs {g.opponent ?? "TBD"}</div></> : "—"}</td>
                    <td className="px-3 py-2 text-xs">{ch.length === 0 ? <span className="text-slate-400">No changes</span> : ch.slice(0, 2).map((c, i) => <div key={i}><Badge tone={c.type === "metric_updated" ? "blue" : c.type === "conflict_detected" ? "amber" : "violet"}>{c.type.replace("_", " ")}</Badge> {c.message.replace(`${a.firstName} ${a.lastName}: `, "")} <span className="text-slate-400">{timeAgo(c.created_at)}</span></div>)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
