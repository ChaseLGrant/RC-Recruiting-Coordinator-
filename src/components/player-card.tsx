import Link from "next/link";
import { toggleFollowAction } from "@/app/actions";
import { metricDef } from "@/lib/domain/metrics";
import type { ResolvedMetric } from "@/lib/domain/provenance";
import type { MatchResult } from "@/lib/domain/types";
import type { AthleteRecord } from "@/lib/repo";
import { Avatar, Badge, fmtDate } from "./ui";
import { DemoTag, MetricValue } from "./evidence";

export function FitPill({ match }: { match: MatchResult }) {
  if (match.total === 0) return null;
  const all = match.matched === match.total;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${all ? "bg-emerald-50 text-emerald-800" : match.eligible ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}>
      {all ? "✓ Fits all " + match.total : `Fits ${match.matched} of ${match.total}`}
    </span>
  );
}

export function gapText(match: MatchResult): string | null {
  const missing = match.criteria.filter((c) => c.status === "missing").map((c) => c.label.replace(/ [≥≤].*$/, "").replace(/^Position: .*/, "position"));
  const fails = match.criteria.filter((c) => c.status === "fail").map((c) => c.label.replace(/ [≥≤].*$/, ""));
  const unverified = match.criteria.filter((c) => c.status === "unverified").map((c) => c.label.replace(/ [≥≤].*$/, "").replace(/ \(verified only\)/, ""));
  const conflict = match.criteria.filter((c) => c.status === "conflict").map((c) => c.label.replace(/ [≥≤].*$/, ""));
  const parts = [
    fails.length ? `Below your standard: ${fails.join(", ")}` : "",
    missing.length ? `No data yet: ${missing.join(", ")}` : "",
    unverified.length ? `Not verified: ${unverified.join(", ")}` : "",
    conflict.length ? `Sources disagree: ${conflict.join(", ")}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export function PlayerCard({
  athlete: a, match, metrics, statKeys, following, nextGame, filmCount, returnTo, compareForm, boardStatus,
}: {
  athlete: AthleteRecord; match?: MatchResult; metrics: Map<string, ResolvedMetric>; statKeys: string[]; following: boolean;
  nextGame?: { starts_at: string; opponent: string | null } | null; filmCount?: number; returnTo: string; compareForm?: string; boardStatus?: string;
}) {
  const gaps = match ? gapText(match) : null;
  return (
    <article className="group relative flex flex-col rounded-2xl bg-white p-4 shadow-[var(--shadow-soft)] ring-1 ring-slate-900/5 transition hover:ring-brand-500/40 sm:p-5">
      <div className="flex items-start gap-3">
        <Avatar first={a.firstName} last={a.lastName} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={`/athletes/${a.id}`} className="text-[17px] font-semibold text-slate-900 after:absolute after:inset-0 hover:text-brand-700">{a.firstName} {a.lastName}</Link>
            {a.isDemo && <DemoTag />}
          </div>
          <p className="truncate text-sm text-slate-500">
            {[a.primaryPosition && `${a.primaryPosition}${a.secondaryPosition ? `/${a.secondaryPosition}` : ""}`, a.gradYear && `Class of ${a.gradYear}`, [a.city, a.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
            {match?.distanceMi != null && ` · ${Math.round(match.distanceMi)} mi`}
          </p>
        </div>
        {match && <FitPill match={match} />}
        {boardStatus && <Badge tone={boardStatus === "priority" ? "amber" : "slate"}>{boardStatus.replace(/_/g, " ")}</Badge>}
      </div>

      <dl className="relative z-10 mt-4 grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-4">
        {statKeys.slice(0, 4).map((k) => (
          <div key={k} className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{metricDef(k).label}</dt>
            <dd className="text-[15px] tabular-nums"><MetricValue m={metrics.get(k)} compact /></dd>
          </div>
        ))}
      </dl>

      {gaps && <p className="mt-3 text-xs text-slate-500">{gaps}</p>}

      <div className="relative z-10 mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <form action={toggleFollowAction}>
          <input type="hidden" name="athleteId" value={a.id} />
          <input type="hidden" name="follow" value={following ? "0" : "1"} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <button className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${following ? "bg-emerald-50 text-emerald-800 hover:bg-emerald-100" : "bg-brand-600 text-white hover:bg-brand-700"}`}>
            {following ? "✓ In My Players" : "+ Add to My Players"}
          </button>
        </form>
        <span className="text-xs text-slate-500">
          {filmCount ? `${filmCount} film clip${filmCount > 1 ? "s" : ""}` : "No film yet"}
          {nextGame ? ` · Next game ${fmtDate(nextGame.starts_at, { month: "short", day: "numeric" })}` : ""}
        </span>
        {compareForm && (
          <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-500">
            <input type="checkbox" name="ids" value={a.id} form={compareForm} className="h-4 w-4 rounded" /> Compare
          </label>
        )}
      </div>
    </article>
  );
}
