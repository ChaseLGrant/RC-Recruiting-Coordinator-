import Link from "next/link";
import { toggleFollowAction } from "@/app/actions";
import { metricDef } from "@/lib/domain/metrics";
import type { ResolvedMetric } from "@/lib/domain/provenance";
import type { MatchResult } from "@/lib/domain/types";
import type { AthleteRecord } from "@/lib/repo";
import { Avatar, Badge, fmtDate, timeAgo } from "./ui";
import { DemoTag, MetricValue } from "./evidence";

export function FitPill({ match }: { match: MatchResult }) {
  if (match.total === 0) return null;
  const all = match.matched === match.total;
  return (
    <span className={`inline-flex items-center gap-1 rounded-[3px] px-2 py-1 text-[11px] font-bold uppercase tracking-wider ${all ? "bg-emerald-50 text-emerald-800" : match.eligible ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}>
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
  athlete: a, match, metrics, statKeys, following, nextGame, filmCount, returnTo, compareForm, boardStatus, lastContact,
}: {
  lastContact?: { label: string; who: string | null; when: string } | null;
  athlete: AthleteRecord; match?: MatchResult; metrics: Map<string, ResolvedMetric>; statKeys: string[]; following: boolean;
  nextGame?: { starts_at: string; opponent: string | null } | null; filmCount?: number; returnTo: string; compareForm?: string; boardStatus?: string;
}) {
  const gaps = match ? gapText(match) : null;
  return (
    <article className="group relative flex min-w-0 flex-col rounded-[4px] border border-slate-900/10 border-t-[3px] border-t-[var(--team-primary)] bg-white p-4 shadow-[var(--shadow-soft)] transition hover:border-slate-900/25 hover:border-t-[var(--team-primary)] sm:p-5">
      <div className="flex items-start gap-3">
        <Avatar first={a.firstName} last={a.lastName} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={`/athletes/${a.id}`} className="font-display text-2xl font-extrabold uppercase leading-none text-slate-900 after:absolute after:inset-0 hover:text-brand-700">{a.firstName} {a.lastName}</Link>
            {a.isDemo && <DemoTag />}
          </div>
          <p className="mt-1 truncate text-[13px] text-slate-500">
            {[a.primaryPosition && `${a.primaryPosition}${a.secondaryPosition ? `/${a.secondaryPosition}` : ""}`, a.gradYear && `Class of ${a.gradYear}`, [a.city, a.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
            {match?.distanceMi != null && ` · ${Math.round(match.distanceMi)} mi`}
          </p>
        </div>
        {match && <FitPill match={match} />}
        {boardStatus && <Badge tone={boardStatus === "priority" ? "amber" : "slate"}>{boardStatus.replace(/_/g, " ")}</Badge>}
      </div>

      <dl className="relative z-10 mt-4 grid grid-cols-2 gap-px border border-slate-900/10 bg-slate-900/10 sm:grid-cols-4">
        {statKeys.slice(0, 4).map((k) => (
          <div key={k} className="min-w-0 bg-white px-3 py-2">
            <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{metricDef(k).label}</dt>
            <dd className="font-display whitespace-nowrap text-xl font-bold tabular-nums"><MetricValue m={metrics.get(k)} compact /></dd>
          </div>
        ))}
      </dl>

      {gaps && <p className="mt-3 text-xs text-slate-500">{gaps}</p>}
      {lastContact !== undefined && (
        <p className="mt-3 text-xs text-slate-600">
          {lastContact ? <>Last contact: <b>{lastContact.label}</b>{lastContact.who ? ` · ${lastContact.who}` : ""} · {timeAgo(lastContact.when)}</> : <span className="text-slate-400">No contact logged yet</span>}
        </p>
      )}

      <div className="relative z-10 mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <form action={toggleFollowAction}>
          <input type="hidden" name="athleteId" value={a.id} />
          <input type="hidden" name="follow" value={following ? "0" : "1"} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <button className={`rounded-[3px] px-3.5 py-2 text-[12px] font-bold uppercase tracking-[0.06em] transition ${following ? "bg-emerald-50 text-emerald-800 hover:bg-emerald-100" : "bg-brand-600 text-white hover:bg-brand-700"}`}>
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
