import Link from "next/link";
import { requireSession } from "@/lib/session";
import { followedIds } from "@/lib/repo";
import { haversineMiles } from "@/lib/domain/geo";
import { Badge, Empty, PageHeader, fmtDate } from "@/components/ui";
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
  const byDay = new Map<string, typeof games>();
  for (const g of games) {
    const d = g.starts_at.slice(0, 10);
    byDay.set(d, [...(byDay.get(d) ?? []), g]);
  }
  return (
    <div>
      <PageHeader title="Schedule" subtitle="Upcoming games for your prospects, from connected sources. A scheduled team game never means RC knows the athlete will play." />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Link href={`/schedule?scope=following&days=${days}`} className={`rounded-full px-3 py-1 ${scope === "following" ? "bg-brand-600 text-white" : "bg-white ring-1 ring-slate-200"}`}>Following</Link>
        <Link href={`/schedule?scope=matched&days=${days}`} className={`rounded-full px-3 py-1 ${scope === "matched" ? "bg-brand-600 text-white" : "bg-white ring-1 ring-slate-200"}`}>Following + mission matches</Link>
        <span className="mx-2 text-slate-300">|</span>
        {[7, 21, 60].map((d) => <Link key={d} href={`/schedule?scope=${scope}&days=${d}`} className={`rounded-full px-3 py-1 ${days === d ? "bg-slate-800 text-white" : "bg-white ring-1 ring-slate-200"}`}>Next {d} days</Link>)}
      </div>
      {games.length === 0 ? <Empty>No upcoming games found for these athletes in connected sources. Import schedules in Settings or follow more prospects.</Empty> : (
        <div className="space-y-4">
          {Array.from(byDay.entries()).map(([day, list]) => (
            <section key={day} className="rounded-xl border border-slate-200 bg-white">
              <h2 className="border-b border-slate-100 px-4 py-2 text-sm font-semibold">{fmtDate(day + "T12:00:00Z", { weekday: "long", month: "long", day: "numeric" })} <span className="font-normal text-slate-500">· {list.length} game{list.length > 1 ? "s" : ""}</span></h2>
              <ul className="divide-y divide-slate-100">
                {list.map((g) => {
                  const dist = org.campus && g.lat != null && g.lng != null ? haversineMiles(org.campus, { lat: g.lat, lng: g.lng }) : null;
                  return (
                    <li key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                      <span className="w-20 text-xs text-slate-500">{new Date(g.starts_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" })} UTC</span>
                      <Link href={`/athletes/${g.athlete_id}`} className="font-medium hover:underline">{g.first_name} {g.last_name}</Link>{g.is_demo ? <DemoTag /> : null}
                      <span className="text-slate-600">{g.primary_position} · {g.grad_year}</span>
                      <span>{g.team_name ?? "Team"} vs {g.opponent ?? "TBD"}</span>
                      <span className="text-slate-500">{g.venue ?? ""}{g.city ? ` · ${g.city}, ${g.state}` : ""}{dist != null ? ` · ${Math.round(dist)} mi from campus` : ""}</span>
                      {g.status === "changed" && <Badge tone="amber">Moved from {fmtDate(g.previous_starts_at, { month: "short", day: "numeric" })}</Badge>}
                      {g.status === "cancelled" && <Badge tone="red">Cancelled</Badge>}
                      {!g.participation_confirmed && <Badge>Participation not confirmed</Badge>}
                      <span className="ml-auto text-xs text-slate-400">{g.source_name}{g.source_url ? <> · <a href={g.source_url} target="_blank" rel="noopener noreferrer" className="text-brand-600 underline">source ↗</a></> : ""}</span>
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
