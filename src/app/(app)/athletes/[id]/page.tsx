import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { getEvidence } from "@/lib/services";
import { listCamps } from "@/lib/repo/approvals";
import { METRICS, metricDef, SEASON_STAT_KEYS } from "@/lib/domain/metrics";
import { listTrackedPages } from "@/lib/watch/runner";
import { listCandidates, listLinks } from "@/lib/finder/finder";
import { getSearchProvider } from "@/lib/finder/search";
import { getAgentClient } from "@/lib/agent/crm-agent";
import { aiAccess } from "@/lib/agent/entitlement";
import { listApprovals } from "@/lib/repo/approvals";
import { ApprovalCard } from "@/components/approval-card";
import { identityConfidenceLabel } from "@/lib/domain/identity";
import { getEmailProvider } from "@/lib/providers/email";
import { can } from "@/lib/domain/permissions";
import { requestAiAddonAction, researchNowAction, findPagesAction, decideLinksAction, deleteContactAction, trackPageAction, untrackPageAction, checkPagesNowAction, deleteAthleteAction, addNoteAction, draftOutreachAction, sendMessageAction, toggleFollowAction, updateContactAction } from "@/app/actions";
import { Avatar, Badge, Button, Card, Flash, Input, Label, Select, fmtDate, timeAgo } from "@/components/ui";
import { LogContactForm } from "@/components/contact-log";
import { CONTACT_KINDS, contactCounts, listContacts, type ContactKind } from "@/lib/repo/contacts";
import { formatInZone, tzAbbrev } from "@/lib/domain/time";
import { DemoTag, MetricValue, VerificationBadge } from "@/components/evidence";

const MISSING_LABEL: Record<string, string> = {
  film: "Film", grad_year: "Graduation year", location: "Hometown location", commitment_status: "Commitment status",
};

export default async function AthletePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ flash?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx, org, user } = await requireSession();
  const ev = await getEvidence(ctx.db, ctx.orgId, id);
  if (!ev) notFound();
  const { athlete: a, metrics } = ev;
  const camps = (await listCamps(ctx.db, ctx.orgId)).filter((c) => c.startsAt > new Date().toISOString());
  const tracked = await listTrackedPages(ctx.db, ctx.orgId, id);
  const seasonKeys = SEASON_STAT_KEYS.filter((k) => metrics.has(k));
  const here = `/athletes/${a.id}`;
  const upcoming = ev.games.filter((g) => g.starts_at > new Date().toISOString());
  const idConf = identityConfidenceLabel(a.identityConfidence);
  const emailReady = org.settings.emailSendingEnabled && Boolean(getEmailProvider());
  const tz = org.settings.timezone;
  const [contacts, counts] = await Promise.all([listContacts(ctx.db, ctx.orgId, a.id), contactCounts(ctx.db, ctx.orgId, a.id)]);
  const [links, pending] = await Promise.all([listLinks(ctx.db, ctx.orgId, a.id), listCandidates(ctx.db, ctx.orgId, { athleteId: a.id, status: "pending" })]);
  const searchReady = Boolean(getSearchProvider());
  const agentReady = Boolean(getAgentClient());
  const access = await aiAccess(ctx.db, org);
  const pendingUpdates = (await listApprovals(ctx.db, ctx.orgId, ["pending", "saved"])).filter((x) => x.kind === "crm_update" && x.athleteId === a.id);
  const lastResearch = await ctx.db.get<{ ran_at: string; note: string | null }>("SELECT ran_at, note FROM agent_runs WHERE org_id = ? AND athlete_id = ? ORDER BY ran_at DESC LIMIT 1", [ctx.orgId, a.id]);

  return (
    <div>
      <Flash flash={sp.flash} error={sp.error} />
      <section className="-mx-4 mb-6 border-y border-slate-900/10 border-t-4 border-t-[var(--team-primary)] bg-white p-4 shadow-[var(--shadow-soft)] sm:mx-0 sm:border-x sm:p-7">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar first={a.firstName} last={a.lastName} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-4xl font-extrabold uppercase leading-[0.9] sm:text-6xl">{a.firstName} {a.lastName}</h1>
              {a.isDemo && <DemoTag />}
              {idConf !== "high" && <Badge tone="amber" title="RC isn't fully sure every linked record is this same player">Check identity</Badge>}
            </div>
            <p className="mt-1.5 text-sm text-slate-600 sm:text-[15px]">
              {[a.primaryPosition && `${a.primaryPosition}${a.secondaryPosition ? ` / ${a.secondaryPosition}` : ""}`, a.gradYear && `Class of ${a.gradYear}`, a.highSchool, [a.city, a.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              {a.commitmentStatus === "unknown" ? <Badge>Commitment unknown</Badge> : a.commitmentStatus === "committed" ? <Badge tone="red">Committed</Badge> : <Badge tone="green">Uncommitted{a.commitmentVerified ? " · confirmed" : " · not confirmed"}</Badge>}
              {ev.film.length > 0 && <a href="#film" className="font-medium text-brand-700 hover:underline">Watch film ({ev.film.length})</a>}
              {upcoming.length > 0 && <a href="#games" className="font-medium text-brand-700 hover:underline">Next game {fmtDate(upcoming[0].starts_at, { month: "short", day: "numeric" })}</a>}
            </p>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <form action={toggleFollowAction}>
              <input type="hidden" name="athleteId" value={a.id} />
              <input type="hidden" name="follow" value={ev.following ? "0" : "1"} />
              <input type="hidden" name="returnTo" value={here} />
              <Button variant={ev.following ? "secondary" : "primary"}>{ev.following ? "✓ In My Players" : "+ Add to My Players"}</Button>
            </form>
            <details className="relative">
              <summary className="inline-flex min-h-9 items-center rounded-[3px] bg-white px-4 py-1.5 text-sm font-semibold text-slate-800 ring-1 ring-inset ring-slate-200 hover:bg-slate-50">Contact…</summary>
              <form action={draftOutreachAction} className="absolute right-0 z-30 mt-2 w-72 space-y-2 rounded-[4px] bg-white p-4 shadow-xl ring-1 ring-slate-200">
                <input type="hidden" name="athleteId" value={a.id} />
                <Label>What should RC draft?</Label>
                <Select name="kind" defaultValue="initial" className="w-full">
                  <option value="initial">Introduce our program</option>
                  <option value="follow_up">Follow up</option>
                  <option value="film_request">Ask for updated film</option>
                  <option value="schedule_request">Ask for their schedule</option>
                  {camps.length > 0 && <option value="camp_invite">Invite to camp</option>}
                </Select>
                {camps.length > 0 && <Select name="campId" className="w-full">{camps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}
                <Button className="w-full">Draft it for my review</Button>
                <p className="text-xs text-slate-500">Nothing is sent. The draft waits in &ldquo;Needs your OK&rdquo;.</p>
              </form>
            </details>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:[grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
          {["height_in", "weight_lb", "exit_velo_mph", "sixty_yd_sec", "inf_velo_mph", "fb_velo_mph", "pop_time_sec", "of_velo_mph", "gpa"].filter((k) => metrics.has(k) || ["height_in", "weight_lb", "exit_velo_mph", "sixty_yd_sec"].includes(k)).slice(0, 6).filter((_, i, arr) => i < arr.length - (arr.length % 2)).map((k) => {
            const m = metrics.get(k);
            return (
              <div key={k} className="border-l-2 border-[var(--team-primary)] bg-slate-50 px-3 py-2.5">
                <div className="eyebrow text-slate-500">{metricDef(k).label}</div>
                <div className="font-display mt-1 text-3xl font-bold"><MetricValue m={m} /></div>
                <div className="text-[11px] text-slate-500">{m ? (m.verifiedBadge ? "Verified" : m.primary.verification === "self_reported" ? "Self-reported" : m.conflict ? "Sources disagree" : "Not verified") : "No data yet"}</div>
              </div>
            );
          })}
        </div>
        {(a.phone || a.email || a.xHandle) && !a.optedOut && (
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            {a.phone && <a href={`tel:${a.phone.replace(/\D/g, "")}`} className="rounded-[3px] bg-brand-600 px-4 py-2 text-[12px] font-bold uppercase tracking-[0.06em] text-white">Call</a>}
            {a.phone && <a href={`sms:${a.phone.replace(/\D/g, "")}`} className="rounded-[3px] border border-slate-300 px-4 py-2 text-[12px] font-bold uppercase tracking-[0.06em]">Text</a>}
            {a.email && <a href={`mailto:${a.email}`} className="rounded-[3px] border border-slate-300 px-4 py-2 text-[12px] font-bold uppercase tracking-[0.06em]">Email</a>}
            {a.xHandle && <a href={`https://x.com/${a.xHandle}`} target="_blank" rel="noopener noreferrer" className="rounded-[3px] border border-slate-300 px-4 py-2 text-[12px] font-bold tracking-[0.04em]">@{a.xHandle} on X</a>}
            <span className="text-xs text-slate-500">{[a.phone, a.email].filter(Boolean).join(" · ")}</span>
          </div>
        )}
        {a.optedOut && <p className="mt-4 bg-rose-50 px-4 py-2.5 text-sm text-rose-900">This player opted out of communications. Don&apos;t contact them.</p>}
        {ev.conflicts.length > 0 && (
          <p className="mt-4 rounded-[4px] bg-amber-50 px-4 py-2.5 text-sm text-amber-900">Sources disagree on {ev.conflicts.map((c) => metricDef(c.key).label.toLowerCase()).join(", ")}. RC shows both numbers instead of picking one. Tap the number to compare.</p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Staff work comes first on a phone: log a contact, read the timeline, leave a note. */}
        <div className="space-y-6 lg:col-start-2 lg:row-start-1">
          <Card title="Recruiting contact" id="contact">
            <LogContactForm athleteId={a.id} returnTo={`${here}#contact`} />
            {contacts.length > 0 && (
              <>
                <div className="mt-5 flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-100 pt-4 text-xs text-slate-500">
                  {Object.entries(counts).map(([k, n]) => <span key={k}><b className="text-slate-800">{n}</b> {CONTACT_KINDS[k as ContactKind]?.label.toLowerCase() ?? k}</span>)}
                </div>
                <ol className="mt-3 space-y-3">
                  {contacts.slice(0, 25).map((c) => (
                    <li key={c.id} className="relative border-l-2 border-[var(--team-primary)] pl-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-semibold">{CONTACT_KINDS[c.kind]?.label ?? c.kind}</span>
                        <span className="text-xs text-slate-400">{formatInZone(c.occurred_at, tz, { month: "short", day: "numeric" })}</span>
                      </div>
                      {c.note && <p className="mt-0.5 text-sm text-slate-600">{c.note}</p>}
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
                        <span>{c.user_name ?? "Staff"}</span>
                        {(c.user_name === user.name || user.role === "head_coach") && (
                          <form action={deleteContactAction}><input type="hidden" name="contactId" value={c.id} /><input type="hidden" name="athleteId" value={a.id} /><button className="hover:text-rose-600">Remove</button></form>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </Card>

          <Card title="Staff notes" id="notes">
            <form action={addNoteAction} className="mb-4 space-y-2">
              <input type="hidden" name="athleteId" value={a.id} />
              <label htmlFor="note-body" className="sr-only">Note for the staff</label>
              <textarea id="note-body" name="body" rows={3} placeholder="Note for the staff: your evaluation, family info, next steps…" className="w-full rounded-[3px] border border-slate-200 p-3 text-sm" />
              <Button variant="secondary">Post note</Button>
            </form>
            {ev.notes.length === 0 ? <p className="text-sm text-slate-500">No notes yet. Everyone on staff sees what you post here.</p> : (
              <ul className="space-y-3">
                {ev.notes.map((n) => (
                  <li key={n.id} className="bg-slate-50 p-3">
                    <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                      <b className="text-slate-800">{n.user_name ?? "Staff"}</b>
                      <span className="text-slate-400">{timeAgo(n.created_at)}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-slate-700">{n.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
          <Card title="Keep him up to date" id="research" action={<form action={researchNowAction}><input type="hidden" name="athleteId" value={a.id} /><button className="text-xs font-bold uppercase tracking-wider text-brand-700 hover:underline">{!agentReady ? "AI not connected" : access.canRun ? "Update with AI now" : "Add AI research"}</button></form>}>
            {pendingUpdates.length > 0 ? (
              <div className="space-y-3">{pendingUpdates.map((ap) => <ApprovalCard key={ap.id} a={ap} returnTo={`${here}#research`} canDecide={can(user.role, "decide_approvals")} canDecideCompliance={can(user.role, "decide_compliance")} />)}</div>
            ) : (
              <p className="text-sm text-slate-500">
                {lastResearch ? <>Last checked {timeAgo(lastResearch.ran_at)}: {lastResearch.note}</> : agentReady ? "RC's research agent hasn't checked this player yet. It looks for new stats, commitments, team changes, games, film and news, and you approve every change." : "Connect AI research in Settings and RC will check this player for new stats, commitments, team changes, games, film and news. You approve every change."}
                {lastResearch && access.automatic && ` RC checks again every ${org.settings.agent.everyDays} days.`}
              </p>
            )}
            {agentReady && access.mode !== "addon" && (
              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 text-xs text-slate-600">
                <span>{access.message}</span>
                {org.settings.plan.requestedAt ? <Badge>Requested {timeAgo(org.settings.plan.requestedAt)}</Badge> : (
                  <form action={requestAiAddonAction}><input type="hidden" name="returnTo" value={`${here}#research`} /><button className="font-bold uppercase tracking-wider text-brand-700 hover:underline">Add automatic AI research</button></form>
                )}
              </div>
            )}
          </Card>

          <Card title="Pages & social" id="pages" action={<form action={findPagesAction}><input type="hidden" name="athleteId" value={a.id} /><button className="text-xs font-bold uppercase tracking-wider text-brand-700 hover:underline">{searchReady ? "Find his pages" : "Search not connected"}</button></form>}>
            {links.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2">
                {links.map((l) => (
                  <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer" className="rounded-[3px] border border-slate-300 px-3 py-2 text-[12px] font-bold uppercase tracking-[0.06em] hover:border-[var(--team-primary)]">
                    {l.site}{l.site === "X" && a.xHandle ? ` @${a.xHandle}` : ""}
                  </a>
                ))}
                {tracked.map((t) => (
                  <a key={t.id} href={t.url} target="_blank" rel="noopener noreferrer" className="rounded-[3px] border border-slate-300 px-3 py-2 text-[12px] font-bold uppercase tracking-[0.06em] hover:border-[var(--team-primary)]">{t.site}</a>
                ))}
              </div>
            )}
            {pending.length > 0 ? (
              <form action={decideLinksAction}>
                <input type="hidden" name="athleteId" value={a.id} />
                <p className="mb-2 text-sm font-semibold">RC found {pending.length} possible page{pending.length > 1 ? "s" : ""}. Keep the ones that are really him:</p>
                <ul className="mb-3 divide-y divide-slate-100 border border-slate-200">
                  {pending.map((c) => (
                    <li key={c.id} className="flex items-start gap-3 p-3">
                      <input type="hidden" name="candidateId" value={c.id} />
                      <input type="checkbox" name="accept" value={c.id} defaultChecked className="mt-1 h-5 w-5 shrink-0 accent-[var(--team-primary)]" aria-label={`Keep ${c.site}`} />
                      <div className="min-w-0 flex-1">
                        <span className="eyebrow text-slate-700">{c.site}</span> <span className="text-[11px] text-slate-400">{c.kind === "stats" ? "Stats & schedule" : c.kind === "film" ? "Film" : "Social"}</span>
                        <a href={c.url} target="_blank" rel="noopener noreferrer" className="block truncate text-sm font-semibold text-brand-700 underline">{c.title || c.url}</a>
                        <p className="text-xs text-slate-500">Matched: {c.reasons}</p>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Button name="decision" value="keep">Keep checked</Button>
                  <Button name="decision" value="none" variant="secondary">None are him</Button>
                </div>
              </form>
            ) : links.length === 0 && tracked.length === 0 ? (
              <p className="text-sm text-slate-500">{searchReady ? "No pages yet. Tap “Find his pages” and RC will search for his MaxPreps, Perfect Game, Hudl, X and Instagram for you to approve." : "Connect a search service in Settings and RC will find his MaxPreps, Perfect Game, Hudl, X and Instagram for you to approve. You can also paste a link below."}</p>
            ) : null}
          </Card>

          <Card title="Season stats" id="season" action={tracked.length > 0 ? <form action={checkPagesNowAction}><input type="hidden" name="athleteId" value={a.id} /><button className="text-xs font-bold uppercase tracking-wider text-brand-700 hover:underline">Check now</button></form> : undefined}>
            {seasonKeys.length > 0 ? (
              <div className="mb-4 grid grid-cols-3 border-l border-t border-slate-900/10 sm:grid-cols-4">
                {seasonKeys.map((k) => (
                  <div key={k} className="border-b border-r border-slate-900/10 bg-white px-3 py-2">
                    <div className="eyebrow text-slate-400">{metricDef(k).label}</div>
                    <div className="font-display whitespace-nowrap text-2xl font-bold"><MetricValue m={metrics.get(k)} compact /></div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mb-4 text-sm text-slate-500">No season stats yet. Link the player&apos;s stats or team schedule page once and RC keeps stats and games updated all season.</p>
            )}
            {tracked.length > 0 && (
              <ul className="mb-4 space-y-2 text-sm">
                {tracked.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2">
                    <Badge tone={t.status === "ok" ? "green" : t.status === "pending" ? "slate" : "amber"}>{t.site}</Badge>
                    <span className="min-w-0 flex-1 text-xs text-slate-500">{t.status === "ok" ? `${t.status_detail ?? "Updating"} · checked ${timeAgo(t.last_fetched_at)}` : t.status_detail ?? "Waiting for first check"}</span>
                    <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-brand-700 underline">Open</a>
                    <form action={untrackPageAction}><input type="hidden" name="pageId" value={t.id} /><input type="hidden" name="athleteId" value={a.id} /><button className="text-xs text-slate-400 hover:text-rose-600">Unlink</button></form>
                  </li>
                ))}
              </ul>
            )}
            <form action={trackPageAction} className="flex flex-col gap-2 sm:flex-row">
              <input type="hidden" name="athleteId" value={a.id} />
              <label htmlFor="track-url" className="sr-only">Stats or schedule page link</label>
              <Input id="track-url" name="url" placeholder="Paste a stats or schedule link (MaxPreps, Perfect Game…)" />
              <Button className="shrink-0">Link & track</Button>
            </form>
          </Card>

          <Card title="Upcoming games" id="games">
            {upcoming.length === 0 ? <p className="text-sm text-slate-500">No upcoming games found yet. Link the team&apos;s schedule page above and RC adds games and changes automatically.</p> : (
              <ul className="divide-y divide-slate-100">
                {upcoming.map((g) => (
                  <li key={g.id} className="flex gap-4 py-3">
                    <div className="w-14 shrink-0 text-center">
                      <div className="eyebrow text-[var(--team-primary)]">{formatInZone(g.starts_at, tz, { month: "short" })}</div>
                      <div className="font-display text-3xl font-extrabold leading-none">{formatInZone(g.starts_at, tz, { day: "numeric" })}</div>
                    </div>
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="font-semibold">{g.team_name ?? "Team"} vs {g.opponent ?? "TBD"}</div>
                      <div className="text-slate-500">
                        {formatInZone(g.starts_at, tz, { weekday: "short", hour: "numeric", minute: "2-digit" })} {tzAbbrev(tz)}
                        {g.venue ? ` · ${g.venue}` : ""}{g.city ? ` · ${g.city}, ${g.state}` : ""}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {g.status === "changed" && <Badge tone="amber">Rescheduled</Badge>}
                        {g.status === "cancelled" && <Badge tone="red">Canceled</Badge>}
                        {!g.participation_confirmed && <Badge title="The team is scheduled; no source confirms this player will play">Playing not confirmed</Badge>}
                        {g.source_url ? <a href={g.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-700 underline">{g.source_name}</a> : <span className="text-xs text-slate-400">{g.source_name}</span>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Where the numbers come from">
            {metrics.size === 0 ? <p className="text-sm text-slate-500">No measurements on record yet.</p> : (
              <ul className="divide-y divide-slate-100">
                {Object.keys(METRICS).filter((k) => metrics.has(k)).map((k) => {
                  const m = metrics.get(k)!;
                  const p = m.primary;
                  const evName = (p as typeof p & { eventName?: string | null }).eventName;
                  return (
                    <li key={k} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                      <span className="w-32 shrink-0 text-sm font-semibold">{metricDef(k).label}</span>
                      <span className="font-display w-24 text-xl font-bold"><MetricValue m={m} compact /></span>
                      <span className="min-w-0 flex-1 text-xs text-slate-500">
                        {p.sourceName}{evName ? ` · ${evName}` : ""} · {p.measuredAt ? `measured ${fmtDate(p.measuredAt)}` : "date unknown"}
                        {m.observations.length > 1 && ` · ${m.observations.length} readings`}
                      </span>
                      <VerificationBadge v={p.verification} badge={m.verifiedBadge} sourceKind={p.sourceKind} />
                    </li>
                  );
                })}
              </ul>
            )}
            {ev.conflicts.length > 0 && (
              <p className="mt-3 bg-amber-50 p-3 text-sm text-amber-900"><b>Sources disagree</b> on {ev.conflicts.map((c) => `${metricDef(c.key).label.toLowerCase()} (${c.conflictDetail})`).join("; ")}. RC shows every value rather than picking one.</p>
            )}
            {ev.missing.length > 0 && <p className="mt-3 text-xs text-slate-500">Not on record yet: {ev.missing.map((k) => MISSING_LABEL[k] ?? METRICS[k]?.label ?? k).join(", ")}. RC never estimates missing numbers.</p>}
          </Card>

          <Card title="Film" id="film">
            {ev.film.length === 0 ? <p className="text-sm text-slate-500">No film yet. Use Contact → &ldquo;Ask for updated film&rdquo;.</p> : (
              <ul className="space-y-2 text-sm">
                {ev.film.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center justify-between gap-2">
                    <a href={f.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-700 hover:underline">▶ {f.title ?? "Watch film"}</a>
                    <span className="text-xs text-slate-500">{f.source_name}{f.recorded_at ? ` · ${fmtDate(f.recorded_at)}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {ev.messages.length > 0 && (
            <Card title="Messages">
              <ul className="divide-y divide-slate-100 text-sm">
                {ev.messages.map((m) => (
                  <li key={m.id} className="py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={m.status === "sent" ? "green" : m.status === "approved" ? "blue" : m.status === "blocked" || m.status === "rejected" || m.status === "failed" ? "red" : "amber"}>{m.status.replace("_", " ")}</Badge>
                      <span className="font-medium">{m.subject}</span>
                      <span className="ml-auto text-xs text-slate-400">{timeAgo(m.created_at)}</span>
                    </div>
                    {m.status_reason && <div className="mt-1 text-xs text-slate-500">{m.status_reason}</div>}
                    {m.status === "approved" && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {emailReady ? (
                          <form action={sendMessageAction}><input type="hidden" name="messageId" value={m.id} /><input type="hidden" name="returnTo" value={here} /><Button className="text-xs">Send now</Button></form>
                        ) : (
                          <a href={`mailto:${m.to_email ?? ""}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`} className="rounded-[3px] px-3 py-2 text-xs font-semibold text-brand-700 ring-1 ring-slate-200 hover:bg-slate-50">Open in my email</a>
                        )}
                        <form action={sendMessageAction}><input type="hidden" name="messageId" value={m.id} /><input type="hidden" name="manual" value="1" /><input type="hidden" name="returnTo" value={here} /><Button variant="ghost" className="text-xs">Mark as sent</Button></form>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <details className="border border-slate-900/10 bg-white">
            <summary className="flex items-center justify-between px-5 py-4 text-sm font-semibold">Contact info, consent & records <span className="text-xs font-normal text-brand-700">Show</span></summary>
            <div className="grid gap-6 border-t border-slate-100 p-5 md:grid-cols-2">
              <form action={updateContactAction} className="space-y-2 text-sm">
                <input type="hidden" name="athleteId" value={a.id} />
                <div><Label>Player email</Label><Input name="email" type="email" defaultValue={a.email ?? ""} /></div>
                <div><Label>Parent/guardian email</Label><Input name="guardianEmail" type="email" defaultValue={a.guardianEmail ?? ""} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>Player phone</Label><Input name="phone" type="tel" defaultValue={a.phone ?? ""} placeholder="(760) 555-0101" /></div>
                  <div><Label>X handle</Label><Input name="xHandle" defaultValue={a.xHandle ? `@${a.xHandle}` : ""} placeholder="@handle" /></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>Contact consent</Label><Select name="contactConsent" defaultValue={a.contactConsent} className="w-full"><option value="unknown">Unknown</option><option value="granted">Granted</option><option value="denied">Denied</option></Select></div>
                  <div><Label>Under 18?</Label><Select name="isMinor" defaultValue={a.isMinor == null ? "" : a.isMinor ? "1" : "0"} className="w-full"><option value="">Unknown</option><option value="1">Yes</option><option value="0">No</option></Select></div>
                </div>
                <label className="flex items-center gap-2"><input type="checkbox" name="optedOut" value="1" defaultChecked={a.optedOut} /> Opted out of communications</label>
                <Button variant="secondary">Save</Button>
              </form>
              <div className="space-y-4 text-sm">
                <div>
                  <div className="eyebrow mb-2 text-slate-500">Linked records</div>
                  <ul className="space-y-1.5">{ev.sources.map((s) => <li key={s.source_id + (s.external_id ?? "")}><b className="font-medium">{s.source_name}</b><span className="block text-xs text-slate-500">Match {Math.round(Number(s.match_confidence) * 100)}% · {s.match_reason}</span></li>)}</ul>
                </div>
                {can(user.role, "manage_settings") && (
                  <form action={deleteAthleteAction} className="space-y-2 border-t border-slate-100 pt-4">
                    <input type="hidden" name="athleteId" value={a.id} />
                    <div className="eyebrow text-rose-700">Remove this player</div>
                    <p className="text-xs text-slate-600">Permanently deletes everything about this player (for a family&apos;s removal request). Can&apos;t be undone.</p>
                    <Input name="reason" placeholder="Reason (e.g. parent requested removal)" required />
                    <Input name="confirm" placeholder="Type DELETE to confirm" required />
                    <Button variant="danger">Permanently delete</Button>
                  </form>
                )}
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
