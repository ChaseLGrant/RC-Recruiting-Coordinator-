import Link from "next/link";
import { requireSession } from "@/lib/session";
import { parseRecruitingRequest } from "@/lib/domain/parser";
import { decodeCriteria, encodeCriteria } from "@/lib/criteria-form";
import { searchAthletes } from "@/lib/services";
import { describeCriteria } from "@/lib/domain/criteria";
import { METRICS, POSITIONS, formatHeight } from "@/lib/domain/metrics";
import { RADIUS_PRESETS } from "@/lib/domain/geo";
import { listProfiles } from "@/lib/repo";
import { listCamps } from "@/lib/repo/approvals";
import { buildCriteriaAction, saveProfileAction } from "@/app/actions";
import { Button, Empty, Flash, Input, Label, Select } from "@/components/ui";
import { SearchBox } from "@/components/search-box";
import { PlayerCard } from "@/components/player-card";
import type { RecruitingCriteria } from "@/lib/domain/types";

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<{ q?: string; c?: string; all?: string; profile?: string; flash?: string; error?: string }> }) {
  const { ctx, org } = await requireSession();
  const sp = await searchParams;
  const profiles = await listProfiles(ctx.db, ctx.orgId);
  const camps = (await listCamps(ctx.db, ctx.orgId)).filter((c) => c.startsAt > new Date().toISOString());

  let criteria: RecruitingCriteria | null = null;
  let parsed: ReturnType<typeof parseRecruitingRequest> | null = null;
  if (sp.q) {
    parsed = parseRecruitingRequest(sp.q, org.campus, org.sport);
    criteria = parsed.criteria;
  } else if (sp.c) criteria = decodeCriteria(sp.c);
  else if (sp.profile) criteria = profiles.find((p) => p.id === sp.profile)?.criteria ?? null;

  const showAll = sp.all === "1";
  const results = criteria ? await searchAthletes(ctx.db, ctx.orgId, criteria, { includeIneligible: showAll, limit: 60 }) : null;
  const encoded = criteria ? encodeCriteria(criteria) : "";
  const statKeys = Array.from(new Set([...(criteria?.metrics.map((m) => m.key) ?? []), "height_in", "weight_lb", "exit_velo_mph", "sixty_yd_sec"])).filter((k) => k !== "gpa").slice(0, 4);
  const here = `/discover?c=${encoded}${showAll ? "&all=1" : ""}`;
  const chips = criteria ? describeCriteria(criteria).filter((d) => !/^Missing data/.test(d)) : [];

  return (
    <div>
      <Flash flash={sp.flash} error={sp.error} />
      <div className="mx-auto max-w-3xl"><SearchBox size="md" defaultValue={sp.q ?? ""} autoFocus={!criteria} /></div>

      {!criteria && (
        <div className="mx-auto mt-10 max-w-xl text-center text-slate-500">
          <h1 className="font-display text-4xl font-extrabold uppercase text-slate-900">Describe the players you need</h1>
          <p className="mt-2 text-[15px]">Class, position, distance from campus, size and measurables, in plain English. RC shows you what it understood before it shows any players.</p>
        </div>
      )}

      {criteria && results && (
        <>
          <div className="mx-auto mt-5 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Looking for</span>
              {chips.map((d) => <span key={d} className="rounded-[3px] bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">{d}</span>)}
              <a href="#filters" className="text-xs font-medium text-slate-500 underline underline-offset-2 hover:text-brand-700">Adjust</a>
            </div>
            {parsed && parsed.warnings.length > 0 && (
              <div className="mt-3 rounded-[4px] bg-amber-50 px-4 py-2.5 text-sm text-amber-900 ring-1 ring-amber-200">{parsed.warnings.join(" ")}</div>
            )}
          </div>

          <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="font-display text-4xl font-extrabold uppercase leading-none sm:text-5xl">
                {results.eligibleCount === 0 ? "No players fit yet" : `${results.eligibleCount} player${results.eligibleCount === 1 ? " fits" : "s fit"} your search`}
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                {results.totalEvaluated === 0
                  ? <>No player data yet. <Link href="/settings#sources" className="underline">Add your data</Link> or connect a source.</>
                  : <>{results.withCompleteVerifiedData} with every number confirmed · searched {results.totalEvaluated} players in your connected sources · tap any number to see its source</>}
              </p>
            </div>
            <div className="flex rounded-[3px] bg-white p-1 text-sm ring-1 ring-slate-900/10">
              <Link href={`/discover?c=${encoded}`} className={`rounded-[3px] px-3.5 py-1.5 font-medium ${!showAll ? "bg-brand-900 text-white" : "text-slate-600"}`}>Fits</Link>
              <Link href={`/discover?c=${encoded}&all=1`} className={`rounded-[3px] px-3.5 py-1.5 font-medium ${showAll ? "bg-brand-900 text-white" : "text-slate-600"}`}>Include close calls</Link>
            </div>
          </div>

          <form id="compare-form" method="get" action="/compare" />
          {results.rows.length === 0 ? (
            <div className="mt-5"><Empty>No one fits every must-have yet. Try &ldquo;Include close calls&rdquo;, loosen a standard, or save the search and RC will keep looking every day.</Empty></div>
          ) : (
            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
              {results.rows.map((r) => (
                <PlayerCard key={r.athlete.id} athlete={r.athlete} match={r.match} metrics={r.metrics} statKeys={statKeys} following={r.following} nextGame={r.nextGame} filmCount={r.filmCount} returnTo={here} compareForm="compare-form" />
              ))}
            </div>
          )}
          {results.rows.length > 1 && (
            <div className="mt-4 text-right"><button form="compare-form" className="rounded-[3px] bg-white px-4 py-2 text-sm font-semibold ring-1 ring-slate-200 hover:bg-slate-50">Compare selected side by side</button></div>
          )}

          <section className="mt-10 rounded-[4px] bg-brand-900 p-6 text-white sm:p-8">
            <h2 className="font-display text-3xl font-extrabold uppercase">Keep looking for me</h2>
            <p className="mt-1 max-w-xl text-sm text-blue-200">RC re-runs this search every day, tells you about new players and changed numbers, and tracks their games. Nothing is sent to anyone without your OK.</p>
            <form action={saveProfileAction} className="mt-5 flex flex-wrap items-end gap-3">
              <input type="hidden" name="criteria" value={encoded} />
              <input type="hidden" name="createMission" value="1" />
              <input type="hidden" name="monitorGames" value="1" />
              <input type="hidden" name="runNow" value="1" />
              <div className="min-w-0 flex-1 basis-60">
                <label htmlFor="save-name" className="mb-1 block text-xs font-medium text-blue-200">Name this search</label>
                <input id="save-name" name="name" required defaultValue={defaultName(criteria)} className="w-full rounded-[4px] border-0 bg-white/10 px-3 py-2.5 text-white placeholder:text-blue-200/60 focus:bg-white/15 focus:outline-none focus:ring-2 focus:ring-white/40" />
              </div>
              <div>
                <label htmlFor="save-schedule" className="mb-1 block text-xs font-medium text-blue-200">How often</label>
                <select id="save-schedule" name="schedule" defaultValue="daily" className="rounded-[4px] border-0 bg-white/10 px-3 py-2.5 text-white focus:outline-none"><option className="text-slate-900" value="daily">Every day</option><option className="text-slate-900" value="weekly">Every week</option></select>
              </div>
              {camps.length > 0 && (
                <div>
                  <label htmlFor="save-camp" className="mb-1 block text-xs font-medium text-blue-200">Also build a camp invite list</label>
                  <select id="save-camp" name="campId" defaultValue={parsed?.actions.prepareCampInvites ? camps[0].id : ""} className="rounded-[4px] border-0 bg-white/10 px-3 py-2.5 text-white focus:outline-none">
                    <option className="text-slate-900" value="">No</option>
                    {camps.map((c) => <option className="text-slate-900" key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              <button className="rounded-[4px] bg-white px-5 py-2.5 text-sm font-semibold text-brand-900 hover:bg-blue-50">Save search</button>
            </form>
          </section>
        </>
      )}

      <details id="filters" className="mt-8 rounded-[4px] bg-white ring-1 ring-slate-900/5" open={!criteria ? false : undefined}>
        <summary className="flex items-center justify-between px-5 py-4 text-[15px] font-semibold">Adjust standards precisely <span className="text-sm font-normal text-brand-700">Open</span></summary>
        <CriteriaEditor criteria={criteria} campusLabel={org.campus?.label ?? null} />
      </details>
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
              <div key={d.key} className="rounded-[4px] border border-slate-200 p-2 text-sm">
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
