// Evidence Mode display primitives. Every value is clickable to reveal its
// provenance: source, measurement date, last-checked date, verification.

import { metricDef } from "@/lib/domain/metrics";
import { freshnessLabel, type ResolvedMetric } from "@/lib/domain/provenance";
import { VERIFICATION_LABEL, type Verification, type CriterionStatus } from "@/lib/domain/types";
import { Badge, fmtDate, timeAgo } from "./ui";

export function VerificationBadge({ v, badge, sourceKind }: { v: Verification; badge?: boolean; sourceKind?: string }) {
  // Who vouched matters: a program's own import is attested by that program, not by an independent provider.
  if (badge && sourceKind === "import")
    return <Badge tone="green" title="Your program's import labeled this as verified; your staff attested to the file. It was not independently confirmed by RC or a licensed provider.">✓ {VERIFICATION_LABEL[v]} · per your import</Badge>;
  if (badge && sourceKind === "demo") return <Badge tone="green" title="Fictional demonstration data">✓ {VERIFICATION_LABEL[v]} · demo</Badge>;
  if (badge) return <Badge tone="green" title="Independently verified or officially published, dated, and not contradicted by an equally trusted source">✓ {VERIFICATION_LABEL[v]}</Badge>;
  if (v === "independently_verified" || v === "official") return <Badge tone="blue">{VERIFICATION_LABEL[v]}</Badge>;
  if (v === "self_reported") return <Badge tone="amber">Self-reported</Badge>;
  return <Badge tone="slate">Unverified</Badge>;
}

export function MetricValue({ m, compact }: { m: ResolvedMetric | undefined; compact?: boolean }) {
  if (!m) return <span className="text-xs text-slate-400" title="No data on record from any connected source">— missing</span>;
  const def = metricDef(m.key);
  return (
    <details className="group relative inline-block">
      <summary className="inline-flex items-center gap-1 rounded px-1 hover:bg-slate-100">
        <span className={m.conflict ? "font-semibold text-rose-700" : m.verifiedBadge ? "font-semibold text-emerald-800" : m.primary.verification === "self_reported" ? "font-semibold text-amber-800" : "font-semibold"}>
          {def.format(m.primary.value)}
        </span>
        {m.verifiedBadge && <span className="text-emerald-600" aria-label="verified">✓</span>}
        {m.conflict && <span className="text-rose-600" aria-label="conflict">⚠</span>}
        {!compact && m.primary.verification === "self_reported" && <span className="text-[10px] uppercase text-amber-700">self-rep.</span>}
      </summary>
      <div className="absolute left-0 z-20 mt-1 w-80 rounded-lg border border-slate-200 bg-white p-3 text-left text-xs shadow-lg">
        <div className="mb-2 font-semibold text-slate-900">{def.label}: where this number comes from</div>
        <ul className="space-y-2">
          {m.observations.map((o, i) => (
            <li key={o.id} className={i === 0 ? "" : "border-t border-slate-100 pt-2"}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{def.format(o.value)}</span>
                <VerificationBadge v={o.verification} badge={i === 0 && m.verifiedBadge} sourceKind={o.sourceKind} />
              </div>
              <div className="mt-1 text-slate-600">Source: {o.sourceName}</div>
              <div className="text-slate-600">Measured: {o.measuredAt ? fmtDate(o.measuredAt) : "date unknown"}</div>
              <div className="text-slate-600">
                RC last checked: {timeAgo(o.checkedAt)}{" "}
                <span className={freshnessLabel(o.checkedAt) === "stale" ? "text-rose-600" : ""}>({freshnessLabel(o.checkedAt)})</span>
              </div>
              {o.sourceUrl ? (
                <a href={o.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-brand-600 underline">Open original source ↗</a>
              ) : (
                <div className="text-slate-400">No public link provided by this source</div>
              )}
            </li>
          ))}
        </ul>
        {m.conflict && <div className="mt-2 rounded bg-rose-50 p-2 text-rose-800">Sources disagree. RC shows every value instead of choosing one: {m.conflictDetail}</div>}
      </div>
    </details>
  );
}

const STATUS_STYLE: Record<CriterionStatus, { tone: "green" | "red" | "slate" | "amber" | "violet"; label: string }> = {
  pass: { tone: "green", label: "Meets" },
  fail: { tone: "red", label: "Doesn't meet" },
  missing: { tone: "slate", label: "Missing info" },
  unverified: { tone: "amber", label: "Not verified" },
  conflict: { tone: "violet", label: "Sources disagree" },
};

export function CriterionChip({ status, label, detail }: { status: CriterionStatus; label: string; detail: string }) {
  const s = STATUS_STYLE[status];
  return (
    <Badge tone={s.tone} title={`${label}: ${detail}`}>
      {status === "pass" ? "✓" : status === "fail" ? "✕" : status === "missing" ? "?" : "!"} {label.replace(/^Position: |^Graduation year/, (x) => (x.startsWith("Position") ? "" : "Class"))}
    </Badge>
  );
}

export function StatusLegend() {
  return (
    <div className="flex flex-wrap gap-2 text-xs text-slate-600">
      {Object.entries(STATUS_STYLE).map(([k, s]) => (
        <Badge key={k} tone={s.tone}>{s.label}</Badge>
      ))}
      <span className="ml-1">Click any number to see its source, date and verification.</span>
    </div>
  );
}

export function DemoTag() {
  return <Badge tone="violet" title="Fictional demonstration data">DEMO</Badge>;
}
