import Link from "next/link";
import { requireSession } from "@/lib/session";
import { parseRecruitingRequest } from "@/lib/domain/parser";
import { decodeCriteria, encodeCriteria } from "@/lib/criteria-form";
import { searchAthletes } from "@/lib/services";
import { describeCriteria } from "@/lib/domain/criteria";
import { METRICS, POSITIONS, formatHeight } from "@/lib/domain/metrics";
import { RADIUS_PRESETS } from "@/lib/domain/geo";
import { listProfiles } from "@/lib/repo";
import { listCamps as listCampsA } from "@/lib/repo/approvals";
import { buildCriteriaAction, saveProfileAction, toggleFollowAction } from "@/app/actions";
import { Badge, Button, Card, Empty, Flash, Input, Label, PageHeader, Select, fmtDate } from "@/components/ui";
import { CriterionChip, DemoTag, MetricValue, StatusLegend } from "@/components/evidence";
import type { RecruitingCriteria } from "@/lib/domain/types";


const EXAMPLE = "Find 2027 and 2028 shortstops within 150 miles of campus. Minimum 5'10\", 175 pounds, 90 mph exit velocity. Show verified stats and film, monitor their upcoming games, and prepare camp invitations for qualified prospects.";

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<{ q?: string; c?: string; all?: string; profile?: string; flash?: string; error?: string }> }) {
  const { ctx, org } = await requireSession();
  const sp = await searchParams;
  const profiles = await listProfiles(ctx.db, ctx.orgId);
  const camps = (await listCampsA(ctx.db, ctx.orgId)).filter((c) => c.startsAt > new Date().toISOString());

  let criteria: RecruitingCriteria | null = null;
  let parsed: ReturnType<typeof parseRecruitingRequest> | null = null;
  if (sp.q) {
    parsed = parseRecruitingRequest(sp.q, org.campus, org.sport);
    criteria = parsed.criteria;
  } else if (sp.c) criteria = decodeCriteria(sp.c);
  else if (sp.profile) criteria = profiles.find((p) => p.id === sp.profile)?.criteria ?? null;

  const showAll = sp.all === "1";
  const results = criteria ? await searchAthletes(ctx.db, ctx.orgId, criteria, { includeIneligible: showAll }) : null;
  const encoded = criteria ? encodeCriteria(criteria) : "";
  const metricCols = Array.from(new Set(["height_in", "weight_lb", ...(criteria?.metrics.map((m) => m.key) ?? []), "exit_velo_mph", "sixty_yd_sec"])).filter((k) => k !== "gpa").slice(0, 6);
  const here = `/discover?c=${encoded}${showAll ? "&all=1" : ""}`;

  return (
    <div>
      <Flash flash={sp.flash} error={sp.error} />
      <PageHeader title="Discover" subtitle="Tell RC what you need in your own words. It shows exactly what it understood, and only objective matches against your standards." />

      <Card className="mb-5">
        <form method="get" action="/discover" className="space-y-2">
          <textarea name="q" rows={3} defaultValue={sp.q ?? ""} placeholder={EXAMPLE} className="w-full rounded-lg border border-slate-300 p-3 text-sm shadow-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100" />
          <div className="flex flex-wrap items-center gap-2">
            <Button>Search</Button>
            <Link href={`/discover?q=${encodeURIComponent(EXAMPLE)}`} className="text-xs text-brand-600 hover:underline">Try the example</Link>
            {profiles.length > 0 && (
              <span className="ml-auto flex items-center gap-1 text-xs text-slate-500">
                Saved profiles:
                {profiles.slice(0, 5).map((p) => <Link key={p.id} href={`/discover?profile=${p.id}`} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700 hover:bg-slate-200">{p.name}</Link>)}
              </span>
            )}
          </div>
        </form>
        {parsed && (
          <div className="mt-3 grid gap-3 rounded-lg bg-slate-50 p-3 text-sm md:grid-cols-2">
            <div>
              <div className="mb-1 font-medium text-slate-700">RC understood:</div>
              <ul className="list-disc pl-5 text-slate-700">{parsed.understood.map((u) => <li key={u}>{u}</li>)}</ul>
            </div>
            {parsed.warnings.length > 0 && (
              <div>
                <div className="mb-1 font-medium text-amber-800">Needs your attention:</div>
                <ul className="list-disc pl-5 text-amber-800">{parsed.warnings.map((u) => <li key={u}>{u}</li>)}</ul>
              </div>
            )}
          </div>
        )}
      </Card>

      <details className="mb-5 rounded-xl border border-slate-200 bg-white shadow-sm" open={!criteria}>
        <summary className="px-4 py-3 text-sm font-semibold">Your recruiting standards {criteria && <span className="font-normal text-slate-500">— {describeCriteria(criteria).join(" · ")}</span>} <span className="text-brand-600">(edit)</span></summary>
        <CriteriaEditor criteria={criteria} campusLabel={org.campus?.label ?? null} />
      </details>

      {results && criteria && (
        <>
          <div className="mb-3 rounded-xl border border-brand-100 bg-brand-50 p-4 text-sm text-brand-900">
            <b>Coach, I found {results.eligibleCount} athlete{results.eligibleCount === 1 ? "" : "s"} matching your standards</b> out of {results.totalEvaluated} evaluated in your connected sources.{" "}
            {results.withCompleteVerifiedData} meet every standard with no missing or unverified data. {results.eligibleCount - results.withCompleteVerifiedData > 0 && `${results.eligibleCount - results.withCompleteVerifiedData} ${results.eligibleCount - results.withCompleteVerifiedData === 1 ? "has" : "have"} gaps flagged below.`}
            {results.totalEvaluated === 0 && <> No athletes are in your database yet — <Link href="/settings#sources" className="underline">import authorized data</Link> or connect a licensed source.</>}
          </div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <StatusLegend />
            <div className="flex gap-2 text-sm">
              <Link href={`/discover?c=${encoded}`} className={`rounded-full px-3 py-1 ${!showAll ? "bg-brand-600 text-white" : "bg-white ring-1 ring-slate-200"}`}>Meets standards</Link>
              <Link href={`/discover?c=${encoded}&all=1`} className={`rounded-full px-3 py-1 ${showAll ? "bg-brand-600 text-white" : "bg-white ring-1 ring-slate-200"}`}>Include near-misses</Link>
            </div>
          </div>

          <form id="compare-form" method="get" action="/compare" />
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2"><button form="compare-form" className="rounded bg-white px-1.5 py-0.5 text-[10px] ring-1 ring-slate-300">Compare</button></th>
                  <th className="px-3 py-2">Athlete</th>
                  <th className="px-3 py-2">Pos / Class</th>
                  <th className="px-3 py-2">Distance</th>
                  {metricCols.map((k) => <th key={k} className="px-3 py-2">{METRICS[k]?.label ?? k}</th>)}
                  <th className="px-3 py-2">Film</th>
                  <th className="px-3 py-2">Next game</th>
                  <th className="px-3 py-2">Your standards</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {results.rows.length === 0 && <tr><td colSpan={10 + metricCols.length} className="p-6"><Empty>No athletes meet these standards yet. RC can keep looking if you save this as a recurring mission.</Empty></td></tr>}
                {results.rows.map(({ athlete: a, match, metrics, filmCount, following, nextGame }) => (
                  <tr key={a.id} className={match.eligible ? "" : "bg-slate-50/60 text-slate-500"}>
                    <td className="px-3 py-2"><input type="checkbox" name="ids" value={a.id} form="compare-form" /></td>
                    <td className="min-w-[15rem] px-3 py-2">
                      <Link href={`/athletes/${a.id}`} className="font-medium text-slate-900 hover:underline">{a.firstName} {a.lastName}</Link> {a.isDemo && <DemoTag />}
                      {a.identityConfidence < 0.85 && <Badge tone="amber" title="Identity match needs review">ID?</Badge>}
                      <div className="max-w-[15rem] truncate text-xs text-slate-500" title={a.highSchool ?? ""}>{[a.city, a.state].filter(Boolean).join(", ")} · {a.highSchool ?? "School unknown"}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{a.primaryPosition ?? "?"}{a.secondaryPosition ? `/${a.secondaryPosition}` : ""} · {a.gradYear ?? "?"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{match.distanceMi != null ? `${Math.round(match.distanceMi)} mi` : "—"}</td>
                    {metricCols.map((k) => <td key={k} className="px-3 py-2 whitespace-nowrap"><MetricValue m={metrics.get(k)} compact /></td>)}
                    <td className="px-3 py-2 whitespace-nowrap">{filmCount ? <Link href={`/athletes/${a.id}#film`} className="text-brand-600 hover:underline">{filmCount} link{filmCount > 1 ? "s" : ""}</Link> : <span className="text-xs text-slate-400">none</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs">{nextGame ? fmtDate(nextGame.starts_at, { month: "short", day: "numeric" }) : "—"}</td>
                    <td className="px-3 py-2">
                      <div className="mb-1 text-xs font-medium">{match.summary}</div>
                      <div className="flex min-w-[12rem] max-w-md flex-wrap gap-1">{match.criteria.filter((c) => c.status !== "pass").map((c) => <CriterionChip key={c.id} {...c} />)}</div>
                    </td>
                    <td className="px-3 py-2">
                      <form action={toggleFollowAction}>
                        <input type="hidden" name="athleteId" value={a.id} />
                        <input type="hidden" name="follow" value={following ? "0" : "1"} />
                        <input type="hidden" name="returnTo" value={here} />
                        <Button variant={following ? "secondary" : "primary"} className="whitespace-nowrap text-xs">{following ? "✓ Following" : "+ Follow"}</Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Card title="Keep RC working on this" className="mt-5">
            <form action={saveProfileAction} className="grid gap-3 md:grid-cols-6">
              <input type="hidden" name="criteria" value={encoded} />
              <div className="md:col-span-2"><Label>Profile name</Label><Input name="name" required defaultValue={defaultName(criteria)} /></div>
              <label className="flex items-end gap-2 text-sm"><input type="checkbox" name="createMission" value="1" defaultChecked={parsed?.actions.saveMission ?? true} /> Recurring mission</label>
              <div><Label>Runs</Label><Select name="schedule" defaultValue="daily"><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="manual">Only when I run it</option></Select></div>
              <label className="flex items-end gap-2 text-sm"><input type="checkbox" name="monitorGames" value="1" defaultChecked={parsed?.actions.monitorGames ?? true} /> Monitor upcoming games</label>
              <div>
                <Label>Prepare camp invitations for</Label>
                <Select name="campId" defaultValue={parsed?.actions.prepareCampInvites && camps[0] ? camps[0].id : ""} className="w-full">
                  <option value="">No camp</option>
                  {camps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
                {parsed?.actions.prepareCampInvites && camps.length === 0 && <p className="mt-1 text-xs text-amber-700">You asked for camp invitations — <Link href="/camps" className="underline">create a camp</Link> first.</p>}
              </div>
              <div className="flex items-center gap-3 md:col-span-6">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="runNow" value="1" defaultChecked /> Run the first pass now</label>
                <Button>Save</Button>
                <span className="text-xs text-slate-500">Missions re-check connected sources, flag new matches and changes, and queue everything for your approval.</span>
              </div>
            </form>
          </Card>
        </>
      )}
    </div>
  );
}

function defaultName(c: RecruitingCriteria) {
  const pos = c.positions.length ? c.positions.join("/") : "Prospects";
  const yrs = c.gradYears.length ? c.gradYears.join("–") + " " : "";
  const loc = c.location.mode === "radius" ? ` within ${c.location.radiusMi} mi` : c.location.mode === "states" ? ` in ${c.location.states?.join(", ")}` : "";
  return `${yrs}${pos}${loc}`;
}

function CriteriaEditor({ criteria, campusLabel }: { criteria: RecruitingCriteria | null; campusLabel: string | null }) {
  const c = criteria;
  const year = new Date().getFullYear();
  const years = [year, year + 1, year + 2, year + 3, year + 4];
  const metric = (k: string) => c?.metrics.find((m) => m.key === k);
  const loc = c?.location;
  return (
    <form action={buildCriteriaAction} className="space-y-4 border-t border-slate-100 p-4">
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label>Graduation year</Label>
          <div className="flex flex-wrap gap-2 text-sm">{years.map((y) => <label key={y} className="flex items-center gap-1"><input type="checkbox" name="gradYears" value={y} defaultChecked={c?.gradYears.includes(y)} />{y}</label>)}</div>
        </div>
        <div className="md:col-span-2">
          <Label>Position</Label>
          <div className="flex flex-wrap gap-2 text-sm">
            {Object.keys(POSITIONS).map((p) => <label key={p} className="flex items-center gap-1" title={POSITIONS[p]}><input type="checkbox" name="positions" value={p} defaultChecked={c?.positions.includes(p)} />{p}</label>)}
            <label className="ml-3 flex items-center gap-1 text-slate-600"><input type="checkbox" name="includeSecondary" value="1" defaultChecked={c?.includeSecondaryPosition ?? true} /> include secondary position</label>
          </div>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label>Location</Label>
          <div className="space-y-1 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="locationMode" value="nationwide" defaultChecked={!loc || loc.mode === "nationwide"} /> Nationwide</label>
            <label className="flex items-center gap-2"><input type="radio" name="locationMode" value="radius" defaultChecked={loc?.mode === "radius"} /> Radius</label>
            <label className="flex items-center gap-2"><input type="radio" name="locationMode" value="states" defaultChecked={loc?.mode === "states"} /> States</label>
          </div>
        </div>
        <div>
          <Label>Radius from</Label>
          <Input name="center" placeholder={campusLabel ? "campus (default)" : "ZIP or City, ST"} defaultValue={loc?.mode === "radius" && loc.center && loc.center.label !== campusLabel ? loc.center.label.replace(/ \d{5}$/, "") : ""} />
          <div className="mt-1 flex gap-2">
            <Select name="radius" defaultValue={String(loc?.radiusMi && RADIUS_PRESETS.includes(loc.radiusMi) ? loc.radiusMi : 150)}>{RADIUS_PRESETS.map((r) => <option key={r} value={r}>{r} miles</option>)}</Select>
            <Input name="radiusCustom" type="number" min={1} placeholder="custom mi" defaultValue={loc?.radiusMi && !RADIUS_PRESETS.includes(loc.radiusMi) ? loc.radiusMi : ""} />
          </div>
          {!campusLabel && <p className="mt-1 text-xs text-amber-700">Set your campus in Settings to search from campus.</p>}
        </div>
        <div><Label>States (comma-separated)</Label><Input name="states" placeholder="TX, OK, LA" defaultValue={loc?.states?.join(", ") ?? ""} /></div>
      </div>
      <div>
        <Label>Measurable standards (leave blank to ignore)</Label>
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {Object.values(METRICS).map((d) => {
            const m = metric(d.key);
            return (
              <div key={d.key} className="rounded-lg border border-slate-200 p-2 text-sm">
                <div className="mb-1 flex items-center justify-between"><span className="font-medium">{d.label} {d.better === "lower" ? "≤" : "≥"}</span>{d.sensitive && <span className="text-[10px] text-slate-500">only when lawfully available</span>}</div>
                <div className="flex gap-1">
                  <Input name={`m_${d.key}`} defaultValue={m ? (d.key === "height_in" ? formatHeight(m.value) : m.value) : ""} placeholder={d.key === "height_in" ? `5'10"` : d.unit} className="w-24" />
                  <Select name={`imp_${d.key}`} defaultValue={m?.importance ?? (d.key === "gpa" ? "preferred" : "required")}>
                    <option value="required">Required</option><option value="preferred">Preferred</option><option value="optional">Optional</option>
                  </Select>
                  <label className="flex items-center gap-1 text-xs" title="Self-reported or unverified values won't count"><input type="checkbox" name={`ver_${d.key}`} value="1" defaultChecked={m?.verifiedOnly} /> verified only</label>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="uncommittedOnly" value="1" defaultChecked={c?.uncommittedOnly} /> Verified uncommitted only</label>
        <span className="flex items-center gap-2">If a required measurement is missing:
          <Select name="missingPolicy" defaultValue={c?.missingPolicy ?? "include"}><option value="include">Keep the athlete, flag the gap</option><option value="exclude">Exclude the athlete</option></Select>
        </span>
        <Button className="ml-auto">Apply standards</Button>
      </div>
    </form>
  );
}
