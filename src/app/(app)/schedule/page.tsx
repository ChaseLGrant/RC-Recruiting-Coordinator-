import Link from "next/link";
import { requireSession } from "@/lib/session";
import { followedIds } from "@/lib/repo";
import { haversineMiles } from "@/lib/domain/geo";
import { Badge, Empty, PageHeader, fmtDate } from "@/components/ui";
import { formatInZone, tzAbbrev } from "@/lib/domain/time";
import { DemoTag } from "@/components/evidence";

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ scope?: string; days?: string }> }) {
  const { ctx, org } = await requireSession();
  const sp = await searchParams;
  const days = Math.min(90, Math.max(1, Number(sp.days) || 21));
  const scope = sp.scope === "matched" ? "matched" : "following";
  const followed = await followedIds(ctx.db, ctx.orgId);
  let ids = Array.from(followed);
  if (scope === "matched") {
    const m = await ctx.db.all<{ athlete_id: string }>("SELECT DISTINCT athlete_id FROM mission_matches WHERE org_id = ? AND eligible = 1", [ctx.orgId]);
    ids = Array.from(new Set([...ids, ...m.map((x) => x.athlete_id)]));
  }
  const now = new Date().toISOString();
  const until = new Date(Date.now() + days * 86_400_000).toISOString();
  const games = ids.length
    ? await ctx.db.all<{ id: string; athlete_id: string; first_name: string; last_name: string; is_demo: number; primary_position: string | null; grad_year: number | null; team_name: string | null; opponent: string | null; venue: string | null; city: string | null; state: string | null; lat: number | null; lng: number | null; starts_at: string; previous_starts_at: string | null; status: string; participation_confirmed: number; source_url: string | null; source_name: string; checked_at: string }>(
        `SELECT g.*, a.first_name, a.last_name, a.is_demo, a.primary_position, a.grad_year, s.name AS source_name FROM games g JOIN athletes a ON a.id = g.athlete_id JOIN sources s ON s.id = g.source_id
         WHERE g.org_id = ? AND g.starts_at > ? AND g.starts_at < ? AND g.athlete_id IN (${ids.map(() => "?").join(",")}) ORDER BY g.starts_at`,
        [ctx.orgId, now, until, ...ids],
      )
    : [];
  const tz = org.settings.timezone;
  const byDay = new Map<string, typeof games>();
  for (const g of games) {
    const d = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(g.starts_at));
    byDay.set(d, [...(byDay.get(d) ?? []), g]);
  }
  return (
    <div>
      <PageHeader title="Schedule" subtitle={`Upcoming games for your recruits, kept current from their linked pages. Times in ${tzAbbrev(tz)}. A team game doesn't guarantee the player is in the lineup.`} />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Link href={`/schedule?scope=following&days=${days}`} className={`rounded-[3px] px-3 py-1 ${scope === "following" ? "bg-brand-600 text-on-brand" : "bg-white ring-1 ring-slate-200"}`}>Following</Link>
        <Link href={`/schedule?scope=matched&days=${days}`} className={`rounded-[3px] px-3 py-1 ${scope === "matched" ? "bg-brand-600 text-on-brand" : "bg-white ring-1 ring-slate-200"}`}>Following + mission matches</Link>
        <span className="mx-2 text-slate-300">|</span>
        {[7, 21, 60].map((d) => <Link key={d} href={`/schedule?scope=${scope}&days=${d}`} className={`rounded-[3px] px-3 py-1 ${days === d ? "bg-slate-800 text-white" : "bg-white ring-1 ring-slate-200"}`}>Next {d} days</Link>)}
      </div>
      {games.length === 0 ? <Empty>No upcoming games found for these athletes in connected sources. Import schedules in Settings or follow more prospects.</Empty> : (
        <div className="space-y-4">
          {Array.from(byDay.entries()).map(([day, list]) => (
            <section key={day}>
              <h2 className="font-display mb-2 text-2xl font-extrabold uppercase">{fmtDate(day + "T12:00:00Z", { weekday: "long", month: "short", day: "numeric" })} <span className="font-sans text-sm font-normal normal-case text-slate-500">· {list.length} game{list.length > 1 ? "s" : ""}</span></h2>
              <ul className="divide-y divide-slate-100 border border-slate-900/10 bg-white">
                {list.map((g) => {
                  const dist = org.campus && g.lat != null && g.lng != null ? haversineMiles(org.campus, { lat: g.lat, lng: g.lng }) : null;
                  return (
                    <li key={g.id} className="flex gap-4 px-4 py-3">
                      <div className="w-16 shrink-0 pt-0.5 text-sm font-bold">{formatInZone(g.starts_at, tz, { hour: "numeric", minute: "2-digit" })}</div>
                      <div className="min-w-0 flex-1">
                        <Link href={`/athletes/${g.athlete_id}`} className="font-semibold hover:text-brand-text">{g.first_name} {g.last_name}</Link>{g.is_demo ? <> <DemoTag /></> : null}
                        <span className="text-sm text-slate-500"> · {g.primary_position} · {g.grad_year}</span>
                        <div className="text-sm text-slate-700">{g.team_name ?? "Team"} vs {g.opponent ?? "TBD"}</div>
                        <div className="text-xs text-slate-500">{[g.venue, g.city && `${g.city}, ${g.state}`, dist != null && `${Math.round(dist)} mi from campus`].filter(Boolean).join(" · ")}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {g.status === "changed" && <Badge tone="amber">Moved from {fmtDate(g.previous_starts_at, { month: "short", day: "numeric" })}</Badge>}
                          {g.status === "cancelled" && <Badge tone="red">Canceled</Badge>}
                          {!g.participation_confirmed && <Badge>Playing not confirmed</Badge>}
                          {g.source_url ? <a href={g.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-text underline">{g.source_name}</a> : <span className="text-xs text-slate-400">{g.source_name}</span>}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
