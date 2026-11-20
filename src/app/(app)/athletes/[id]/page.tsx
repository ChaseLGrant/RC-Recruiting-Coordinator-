import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { getEvidence } from "@/lib/services";
import { listCamps } from "@/lib/repo/approvals";
import { METRICS, metricDef } from "@/lib/domain/metrics";
import { identityConfidenceLabel } from "@/lib/domain/identity";
import { freshnessLabel } from "@/lib/domain/provenance";
import { getEmailProvider } from "@/lib/providers/email";
import { can } from "@/lib/domain/permissions";
import { deleteAthleteAction, addNoteAction, draftOutreachAction, sendMessageAction, toggleFollowAction, updateContactAction } from "@/app/actions";
import { Avatar, Badge, Button, Card, Empty, Flash, Input, Label, Select, fmtDate, fmtDateTime, timeAgo } from "@/components/ui";
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
  const here = `/athletes/${a.id}`;
  const upcoming = ev.games.filter((g) => g.starts_at > new Date().toISOString());
  const idConf = identityConfidenceLabel(a.identityConfidence);
  const emailReady = org.settings.emailSendingEnabled && Boolean(getEmailProvider());

  return (
    <div>
      <Flash flash={sp.flash} error={sp.error} />
      <section className="mb-6 rounded-3xl bg-white p-5 shadow-[var(--shadow-soft)] ring-1 ring-slate-900/5 sm:p-7">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar first={a.firstName} last={a.lastName} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{a.firstName} {a.lastName}</h1>
              {a.isDemo && <DemoTag />}
              {idConf !== "high" && <Badge tone="amber" title="RC isn't fully sure every linked record is this same player">Check identity</Badge>}
            </div>
            <p className="mt-1 text-[15px] text-slate-600">
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
              <summary className="inline-flex min-h-9 items-center rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-slate-800 ring-1 ring-inset ring-slate-200 hover:bg-slate-50">Contact…</summary>
              <form action={draftOutreachAction} className="absolute right-0 z-30 mt-2 w-72 space-y-2 rounded-2xl bg-white p-4 shadow-xl ring-1 ring-slate-200">
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
              <div key={k} className="rounded-2xl bg-slate-50 p-3">
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{metricDef(k).label}</div>
                <div className="mt-1 text-lg"><MetricValue m={m} /></div>
                <div className="text-[11px] text-slate-500">{m ? (m.verifiedBadge ? "Verified" : m.primary.verification === "self_reported" ? "Self-reported" : m.conflict ? "Sources disagree" : "Not verified") : "No data yet"}</div>
              </div>
            );
          })}
        </div>
        {ev.conflicts.length > 0 && (
          <p className="mt-4 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-900">Sources disagree on {ev.conflicts.map((c) => metricDef(c.key).label.toLowerCase()).join(", ")}. RC shows both numbers instead of picking one. Tap the number to compare.</p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Every number and where it came from">
            {metrics.size === 0 ? <Empty>No measurements on record from any connected source.</Empty> : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1 pr-3">Metric</th><th className="pr-3">Value</th><th className="pr-3">Verification</th><th className="pr-3">Source</th><th className="pr-3">Measured</th><th className="pr-3">RC last checked</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {Object.keys(METRICS).filter((k) => metrics.has(k)).map((k) => {
                      const m = metrics.get(k)!;
                      const p = m.primary;
                      return (
                        <tr key={k} className={m.conflict ? "bg-rose-50/50" : ""}>
                          <td className="py-2 pr-3 font-medium">{metricDef(k).label}{m.observations.length > 1 && <div className="text-xs font-normal text-slate-500">{m.observations.length} observations</div>}</td>
                          <td className="pr-3"><MetricValue m={m} /></td>
                          <td className="pr-3"><VerificationBadge v={p.verification} badge={m.verifiedBadge} sourceKind={p.sourceKind} /></td>
                          <td className="pr-3 text-xs">{p.sourceName}{(p as typeof p & { eventName?: string | null }).eventName ? <div className="text-slate-500">{(p as typeof p & { eventName?: string | null }).eventName}</div> : null}</td>
                          <td className="pr-3 text-xs">{p.measuredAt ? fmtDate(p.measuredAt) : <span className="text-amber-700">unknown</span>}</td>
                          <td className="pr-3 text-xs">{timeAgo(p.checkedAt)} <span className={freshnessLabel(p.checkedAt) === "stale" ? "text-rose-600" : "text-slate-400"}>({freshnessLabel(p.checkedAt)})</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {ev.conflicts.length > 0 && (
              <div className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-900">
                <b>Sources disagree.</b> RC shows every value and its date instead of choosing one:
                <ul className="mt-1 list-disc pl-5">{ev.conflicts.map((c) => <li key={c.key}>{metricDef(c.key).label}: {c.conflictDetail}</li>)}</ul>
              </div>
            )}
            {ev.missing.length > 0 && (
              <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                <b>Missing information:</b> {ev.missing.map((k) => MISSING_LABEL[k] ?? METRICS[k]?.label ?? k).join(", ")}. RC never estimates missing measurements.
              </div>
            )}
          </Card>

          <Card title="Film" id="film">
            {ev.film.length === 0 ? <Empty>No film links on record. Use “Request updated film” to ask for some.</Empty> : (
              <ul className="space-y-2 text-sm">
                {ev.film.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center justify-between gap-2">
                    <a href={f.url} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 hover:underline">{f.title ?? f.url} ↗</a>
                    <span className="text-xs text-slate-500">Source: {f.source_name} · recorded {fmtDate(f.recorded_at)} · checked {timeAgo(f.checked_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Upcoming games" id="games">
            {upcoming.length === 0 ? <Empty>No upcoming games found in connected sources.</Empty> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {upcoming.map((g) => (
                  <li key={g.id} className="py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <b>{fmtDateTime(g.starts_at)}</b> · {g.team_name ?? "Team"} vs {g.opponent ?? "TBD"} · {g.venue ?? "Venue TBD"}{g.city ? `, ${g.city}, ${g.state}` : ""}
                      {g.status === "changed" && <Badge tone="amber">Rescheduled (was {fmtDate(g.previous_starts_at)})</Badge>}
                      {g.status === "cancelled" && <Badge tone="red">Cancelled</Badge>}
                      {g.participation_confirmed ? <Badge tone="green">Participation confirmed</Badge> : <Badge title="The team is scheduled; no source confirms this athlete will play">Participation not confirmed</Badge>}
                    </div>
                    <div className="text-xs text-slate-500">Source: {g.source_name} · checked {timeAgo(g.checked_at)} {g.source_url ? <a href={g.source_url} target="_blank" rel="noopener noreferrer" className="text-brand-600 underline">original schedule ↗</a> : "· no public link provided"}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Communication history">
            {ev.messages.length === 0 ? <Empty>No messages yet.</Empty> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {ev.messages.map((m) => (
                  <li key={m.id} className="py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={m.status === "sent" ? "green" : m.status === "approved" ? "blue" : m.status === "blocked" || m.status === "rejected" || m.status === "failed" ? "red" : "amber"}>{m.status.replace("_", " ")}</Badge>
                      <span className="font-medium">{m.subject}</span>
                      <span className="ml-auto text-xs text-slate-400">{timeAgo(m.created_at)}</span>
                    </div>
                    {m.status_reason && <div className="text-xs text-slate-500">{m.status_reason}</div>}
                    {m.status === "approved" && (
                      <div className="mt-1 flex flex-wrap gap-2">
                        {emailReady ? (
                          <form action={sendMessageAction}><input type="hidden" name="messageId" value={m.id} /><input type="hidden" name="returnTo" value={here} /><Button variant="success" className="text-xs">Send now</Button></form>
                        ) : (
                          <a href={`mailto:${m.to_email ?? ""}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`} className="rounded-lg px-2 py-1 text-xs text-brand-700 ring-1 ring-brand-100 hover:bg-brand-50">Open in my email client</a>
                        )}
                        <form action={sendMessageAction}><input type="hidden" name="messageId" value={m.id} /><input type="hidden" name="manual" value="1" /><input type="hidden" name="returnTo" value={here} /><Button variant="ghost" className="text-xs">Mark as sent</Button></form>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Coach notes">
            <form action={addNoteAction} className="mb-3 space-y-2">
              <input type="hidden" name="athleteId" value={a.id} />
              <textarea name="body" rows={3} placeholder="Your evaluation — RC never writes these for you." className="w-full rounded-lg border border-slate-300 p-2 text-sm" />
              <Button variant="secondary">Add note</Button>
            </form>
            <ul className="space-y-2 text-sm">{ev.notes.map((n) => <li key={n.id} className="rounded-lg bg-slate-50 p-2"><div className="whitespace-pre-wrap">{n.body}</div><div className="mt-1 text-xs text-slate-400">{n.user_name} · {timeAgo(n.created_at)}</div></li>)}</ul>
          </Card>

          <Card title="Linked source records">
            <ul className="space-y-2 text-sm">
              {ev.sources.map((s) => (
                <li key={s.source_id + (s.external_id ?? "")}>
                  <div className="font-medium">{s.source_name}</div>
                  <div className="text-xs text-slate-500">Match: {Math.round(Number(s.match_confidence) * 100)}% — {s.match_reason} · fetched {timeAgo(s.fetched_at)}</div>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Contact & consent">
            <form action={updateContactAction} className="space-y-2 text-sm">
              <input type="hidden" name="athleteId" value={a.id} />
              <div><Label>Athlete email</Label><Input name="email" type="email" defaultValue={a.email ?? ""} /></div>
              <div><Label>Parent/guardian email</Label><Input name="guardianEmail" type="email" defaultValue={a.guardianEmail ?? ""} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Contact consent</Label><Select name="contactConsent" defaultValue={a.contactConsent} className="w-full"><option value="unknown">Unknown</option><option value="granted">Granted</option><option value="denied">Denied</option></Select></div>
                <div><Label>Under 18?</Label><Select name="isMinor" defaultValue={a.isMinor == null ? "" : a.isMinor ? "1" : "0"} className="w-full"><option value="">Unknown</option><option value="1">Yes</option><option value="0">No</option></Select></div>
              </div>
              <label className="flex items-center gap-2"><input type="checkbox" name="optedOut" value="1" defaultChecked={a.optedOut} /> Opted out of communications</label>
              <Button variant="secondary">Save</Button>
              <p className="text-xs text-slate-500">Used by compliance checks. Opted-out athletes are never contacted.</p>
            </form>
          </Card>

          {can(user.role, "manage_settings") && (
            <Card title="Privacy: remove this athlete">
              <form action={deleteAthleteAction} className="space-y-2 text-sm">
                <input type="hidden" name="athleteId" value={a.id} />
                <p className="text-xs text-slate-600">Permanently deletes this athlete and every measurement, note, message and schedule record about them (for example, a family&apos;s removal request). This cannot be undone. The audit log records that a deletion happened and why, but not the athlete&apos;s details.</p>
                <Input name="reason" placeholder="Reason (e.g. parent requested removal)" required />
                <Input name="confirm" placeholder="Type DELETE to confirm" required />
                <Button variant="danger">Permanently delete</Button>
              </form>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
