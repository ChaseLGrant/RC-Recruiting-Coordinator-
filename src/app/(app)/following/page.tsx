import Link from "next/link";
import { requireSession } from "@/lib/session";
import { listAthletes, listFollows, listObservations } from "@/lib/repo";
import { resolveAll } from "@/lib/domain/provenance";
import { nextGames } from "@/lib/services";
import { toggleFollowAction } from "@/app/actions";
import { Empty, Flash, LinkButton, timeAgo } from "@/components/ui";
import { PlayerCard } from "@/components/player-card";
import { CONTACT_KINDS, lastContacts } from "@/lib/repo/contacts";

const BOARD = [
  { id: "priority", label: "Priority" },
  { id: "evaluating", label: "Evaluating" },
  { id: "watching", label: "Watching" },
  { id: "contacted", label: "Contacted" },
  { id: "not_a_fit", label: "Not a fit" },
];

export default async function MyPlayersPage({ searchParams }: { searchParams: Promise<{ flash?: string; error?: string; status?: string }> }) {
  const { ctx } = await requireSession();
  const sp = await searchParams;
  const follows = await listFollows(ctx.db, ctx.orgId);
  const ids = follows.map((f) => f.athlete_id);
  const athletes = new Map((await listAthletes(ctx.db, ctx.orgId, { ids })).map((a) => [a.id, a]));
  const obs = await listObservations(ctx.db, ctx.orgId, ids);
  const games = await nextGames(ctx.db, ctx.orgId, ids);
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const changes = ids.length
    ? await ctx.db.all<{ athlete_id: string; message: string; created_at: string }>(
        `SELECT athlete_id, message, created_at FROM events WHERE org_id = ? AND created_at > ? AND type IN ('metric_updated','schedule_changed') AND athlete_id IN (${ids.map(() => "?").join(",")}) ORDER BY created_at DESC`,
        [ctx.orgId, since, ...ids],
      )
    : [];
  const film = ids.length ? await ctx.db.all<{ athlete_id: string; n: number }>(`SELECT athlete_id, COUNT(*) AS n FROM film_links WHERE org_id = ? AND athlete_id IN (${ids.map(() => "?").join(",")}) GROUP BY athlete_id`, [ctx.orgId, ...ids]) : [];
  const filmBy = new Map(film.map((f) => [f.athlete_id, Number(f.n)]));
  const rows = follows.filter((f) => !sp.status || f.board_status === sp.status);
  const last = await lastContacts(ctx.db, ctx.orgId, ids);
  const here = `/following${sp.status ? `?status=${sp.status}` : ""}`;

  return (
    <div>
      <Flash flash={sp.flash} error={sp.error} />
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl font-extrabold uppercase leading-none sm:text-5xl">My Players</h1>
          <p className="mt-1 text-[15px] text-slate-500">RC watches these players for new numbers and schedule changes and tells you on Home.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LinkButton href="/import" variant="primary">Import your list</LinkButton>
          {ids.length > 1 && <LinkButton href={`/compare?${ids.slice(0, 3).map((i) => `ids=${i}`).join("&")}`}>Compare top {Math.min(3, ids.length)}</LinkButton>}
        </div>
      </div>

      <div className="mb-5 flex gap-2 overflow-x-auto pb-1 text-sm">
        <Link href="/following" className={`shrink-0 rounded-[3px] px-3.5 py-1.5 font-medium ${!sp.status ? "bg-brand-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-900/10"}`}>All {follows.length}</Link>
        {BOARD.map((b) => (
          <Link key={b.id} href={`/following?status=${b.id}`} className={`shrink-0 rounded-[3px] px-3.5 py-1.5 font-medium ${sp.status === b.id ? "bg-brand-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-900/10"}`}>
            {b.label} {follows.filter((f) => f.board_status === b.id).length}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <Empty>No players here yet. <Link href="/import" className="font-medium text-brand-700 underline">Import the list you already have</Link>, or <Link href="/" className="font-medium text-brand-700 underline">search for players</Link> and tap &ldquo;Add to My Players&rdquo;.</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((f) => {
            const a = athletes.get(f.athlete_id);
            if (!a) return null;
            const recent = changes.filter((c) => c.athlete_id === a.id)[0];
            return (
              <div key={a.id} className="flex flex-col gap-2">
                <PlayerCard athlete={a} metrics={resolveAll(obs.filter((o) => o.athleteId === a.id))} statKeys={["height_in", "weight_lb", "exit_velo_mph", "sixty_yd_sec"]} following nextGame={games.get(a.id)} filmCount={filmBy.get(a.id)} returnTo={here} boardStatus={f.board_status} lastContact={last.get(a.id) ? { label: CONTACT_KINDS[last.get(a.id)!.kind]?.label ?? "Contact", who: last.get(a.id)!.user_name, when: last.get(a.id)!.occurred_at } : null} />
                <div className="flex flex-wrap items-center gap-2 px-1 text-xs text-slate-500">
                  {recent && <span className="rounded-[3px] bg-sky-50 px-2.5 py-1 text-sky-800">New: {recent.message.replace(`${a.firstName} ${a.lastName}: `, "")} · {timeAgo(recent.created_at)}</span>}
                  <form action={toggleFollowAction} className="ml-auto flex items-center gap-1">
                    <input type="hidden" name="athleteId" value={a.id} /><input type="hidden" name="follow" value="1" /><input type="hidden" name="returnTo" value={here} />
                    <label htmlFor={`bs-${a.id}`} className="sr-only">Board status</label>
                    <select id={`bs-${a.id}`} name="boardStatus" defaultValue={f.board_status} className="rounded-[3px] border-0 bg-white px-2.5 py-1 text-xs ring-1 ring-slate-900/10">
                      {BOARD.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                    </select>
                    <button className="rounded-[3px] px-2 py-1 font-medium text-brand-700 hover:bg-brand-50">Move</button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
