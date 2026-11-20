import Link from "next/link";
import { requireSession } from "@/lib/session";
import { countEventsByType } from "@/lib/repo";
import { estimateSavings, formatMinutes, EVENT_TYPES, type EventType } from "@/lib/domain/timesavings";
import { updateAssumptionsAction } from "@/app/actions";
import { Button, Card, Flash, PageHeader } from "@/components/ui";

export default async function ImpactPage({ searchParams }: { searchParams: Promise<{ range?: string; flash?: string }> }) {
  const { ctx, org } = await requireSession();
  const sp = await searchParams;
  const range = sp.range === "all" ? "all" : sp.range === "7" ? "7" : "30";
  const since = range === "all" ? "1970-01-01" : new Date(Date.now() - Number(range) * 86_400_000).toISOString();
  const counts = await countEventsByType(ctx.db, ctx.orgId, since);
  const est = estimateSavings(counts, org.settings.minutesPerTask);
  const measured: EventType[] = ["athlete_researched", "source_checked", "athlete_discovered", "metric_verified", "metric_updated", "game_identified", "draft_prepared", "task_created", "coach_action", "conflict_detected"];
  return (
    <div>
      <Flash flash={sp.flash} />
      <PageHeader title="Time RC saved you" subtitle="Counts are measured from RC's activity log. Time saved is an estimate based on the assumptions below, which you control." actions={
        <div className="flex gap-2 text-sm">{[["7", "7 days"], ["30", "30 days"], ["all", "All time"]].map(([v, l]) => <Link key={v} href={`/impact?range=${v}`} className={`rounded-full px-3 py-1 ${range === v ? "bg-brand-600 text-white" : "bg-white ring-1 ring-slate-200"}`}>{l}</Link>)}</div>
      } />
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 md:col-span-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Estimated administrative time saved</div>
          <div className="mt-1 text-3xl font-semibold text-emerald-900">{formatMinutes(est.totalMinutes)}</div>
          <div className="mt-1 text-xs text-emerald-800">ESTIMATE — measured task counts × your minutes-per-task assumptions. Not a measured result.</div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:col-span-2 md:grid-cols-5">
          {measured.map((t) => (
            <div key={t} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-xl font-semibold tabular-nums">{counts[t] ?? 0}</div>
              <div className="text-xs text-slate-600">{EVENT_TYPES[t]}</div>
              <div className="text-[10px] uppercase text-slate-400">measured</div>
            </div>
          ))}
        </div>
      </div>
      <Card title="How the estimate is calculated (edit the assumptions)">
        <form action={updateAssumptionsAction}>
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Task RC performed</th><th>Measured count</th><th>Minutes a staffer would spend each (assumption)</th><th>Estimated minutes</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {est.lines.map((l) => (
                <tr key={l.type}>
                  <td className="py-1.5">{l.label}</td>
                  <td className="tabular-nums">{l.count}</td>
                  <td><input name={`min_${l.type}`} type="number" min={0} step={0.5} defaultValue={l.minutesEach} className="w-20 rounded border border-slate-300 px-2 py-0.5" /></td>
                  <td className="tabular-nums">{formatMinutes(l.minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button className="mt-3">Save assumptions</Button>
        </form>
      </Card>
    </div>
  );
}
