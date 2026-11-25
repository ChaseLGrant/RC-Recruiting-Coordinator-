import Link from "next/link";
import { requireSession } from "@/lib/session";
import { getEvidence } from "@/lib/services";
import { METRICS } from "@/lib/domain/metrics";
import { Empty, PageHeader } from "@/components/ui";
import { DemoTag, MetricValue } from "@/components/evidence";

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ ids?: string | string[] }> }) {
  const { ctx } = await requireSession();
  const sp = await searchParams;
  const ids = (Array.isArray(sp.ids) ? sp.ids : sp.ids ? [sp.ids] : []).slice(0, 5);
  const list = (await Promise.all(ids.map((id) => getEvidence(ctx.db, ctx.orgId, id)))).filter((x): x is NonNullable<typeof x> => Boolean(x));
  if (list.length === 0) return <div><PageHeader title="Compare" /><Empty>Select athletes to compare from Discover or Following.</Empty></div>;
  const keys = Object.keys(METRICS).filter((k) => list.some((e) => e.metrics.has(k)));
  return (
    <div>
      <PageHeader title="Side-by-side comparison" subtitle="Facts only, with sources. Click a value to see where it came from. RC does not rank athletes." />
      <div className="overflow-x-auto rounded-[4px] border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead><tr className="border-b border-slate-100"><th className="px-3 py-2" />{list.map((e) => <th key={e.athlete.id} className="px-3 py-2 text-left"><Link href={`/athletes/${e.athlete.id}`} className="hover:underline">{e.athlete.firstName} {e.athlete.lastName}</Link> {e.athlete.isDemo && <DemoTag />}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            <Row label="Position" vals={list.map((e) => `${e.athlete.primaryPosition ?? "?"}${e.athlete.secondaryPosition ? ` / ${e.athlete.secondaryPosition}` : ""}`)} />
            <Row label="Class" vals={list.map((e) => String(e.athlete.gradYear ?? "?"))} />
            <Row label="School" vals={list.map((e) => e.athlete.highSchool ?? "—")} />
            <Row label="Hometown" vals={list.map((e) => [e.athlete.city, e.athlete.state].filter(Boolean).join(", ") || "—")} />
            <Row label="Commitment" vals={list.map((e) => `${e.athlete.commitmentStatus}${e.athlete.commitmentStatus !== "unknown" ? (e.athlete.commitmentVerified ? " (verified)" : " (unverified)") : ""}`)} />
            {keys.map((k) => (
              <tr key={k}><td className="px-3 py-2 font-medium text-slate-600">{METRICS[k].label}</td>{list.map((e) => <td key={e.athlete.id} className="px-3 py-2"><MetricValue m={e.metrics.get(k)} /></td>)}</tr>
            ))}
            <tr><td className="px-3 py-2 font-medium text-slate-600">Film</td>{list.map((e) => <td key={e.athlete.id} className="px-3 py-2">{e.film.length ? e.film.map((f) => <a key={f.id} href={f.url} target="_blank" rel="noopener noreferrer" className="block text-brand-text underline">{f.title ?? "Film"} ↗</a>) : <span className="text-slate-400">none</span>}</td>)}</tr>
            <Row label="Upcoming games" vals={list.map((e) => String(e.games.filter((g) => g.starts_at > new Date().toISOString()).length))} />
            <Row label="Missing info" vals={list.map((e) => e.missing.length ? e.missing.join(", ").replace(/_/g, " ") : "none")} />
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ label, vals }: { label: string; vals: string[] }) {
  return <tr><td className="px-3 py-2 font-medium text-slate-600">{label}</td>{vals.map((v, i) => <td key={i} className="px-3 py-2">{v}</td>)}</tr>;
}
