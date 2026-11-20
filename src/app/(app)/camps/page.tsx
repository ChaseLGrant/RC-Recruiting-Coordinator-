import Link from "next/link";
import { requireSession } from "@/lib/session";
import { listAthletes, listProfiles } from "@/lib/repo";
import { listCampTargets, listCamps, listMessages } from "@/lib/repo/approvals";
import { campTargetStatusAction, campTargetingAction, createCampAction } from "@/app/actions";
import { Badge, Button, Card, Empty, Flash, Input, Label, PageHeader, Select, fmtDate } from "@/components/ui";
import { DemoTag } from "@/components/evidence";

export default async function CampsPage({ searchParams }: { searchParams: Promise<{ flash?: string; error?: string }> }) {
  const { ctx } = await requireSession();
  const sp = await searchParams;
  const camps = await listCamps(ctx.db, ctx.orgId);
  const profiles = await listProfiles(ctx.db, ctx.orgId);
  const data = await Promise.all(camps.map(async (c) => ({ camp: c, targets: await listCampTargets(ctx.db, ctx.orgId, c.id), messages: await listMessages(ctx.db, ctx.orgId, { campId: c.id }) })));
  const athleteIds = Array.from(new Set(data.flatMap((d) => d.targets.map((t) => t.athlete_id))));
  const athletes = new Map((await listAthletes(ctx.db, ctx.orgId, { ids: athleteIds })).map((a) => [a.id, a]));

  return (
    <div>
      <Flash flash={sp.flash} error={sp.error} />
      <PageHeader title="Camps" subtitle="Target prospects who fit your camp standards. RC builds the invitation list and personalized drafts — you approve, compliance checks run, nothing sends on its own." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {data.length === 0 && <Empty>No camps yet. Create one to start targeting prospects.</Empty>}
          {data.map(({ camp, targets, messages }) => {
            const msgBy = new Map(messages.map((m) => [m.athlete_id, m]));
            const counts = targets.reduce<Record<string, number>>((acc, t) => ((acc[t.status] = (acc[t.status] ?? 0) + 1), acc), {});
            return (
              <Card key={camp.id} title={<>{camp.name} <span className="font-normal text-slate-500">· {fmtDate(camp.startsAt)}{camp.location ? ` · ${camp.location}` : ""}</span></>}>
                <div className="mb-3 flex flex-wrap gap-2 text-xs">
                  <Badge>{targets.length} targeted</Badge>
                  {Object.entries(counts).map(([s, n]) => <Badge key={s} tone={s === "registered" || s === "attended" ? "green" : s === "declined" ? "red" : "blue"}>{n} {s.replace("_", " ")}</Badge>)}
                  <Badge tone="violet">{messages.filter((m) => m.status === "sent").length} invitations sent</Badge>
                  <Badge tone="amber">{messages.filter((m) => m.status === "compliance_review").length} in compliance review</Badge>
                </div>
                <form action={campTargetingAction} className="mb-4 flex flex-wrap items-end gap-2 rounded-[4px] bg-slate-50 p-3">
                  <input type="hidden" name="campId" value={camp.id} /><input type="hidden" name="campName" value={camp.name} />
                  <div><Label>Target prospects matching</Label>
                    <Select name="profileId" defaultValue={camp.profileId ?? ""}><option value="">Choose a recruiting profile…</option>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
                  </div>
                  <Button>Find & build invitation list</Button>
                  {profiles.length === 0 && <span className="text-xs text-slate-500">Save a profile in <Link href="/discover" className="underline">Discover</Link> first (radius, position, year, size, metrics).</span>}
                </form>
                {targets.length === 0 ? <Empty>No prospects targeted yet.</Empty> : (
                  <table className="min-w-full text-sm">
                    <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Athlete</th><th>Invitation</th><th>Registration</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {targets.map((t) => {
                        const a = athletes.get(t.athlete_id);
                        const m = msgBy.get(t.athlete_id);
                        return (
                          <tr key={t.athlete_id}>
                            <td className="py-1.5">{a ? <Link href={`/athletes/${a.id}`} className="hover:underline">{a.firstName} {a.lastName}</Link> : "—"} {a?.isDemo && <DemoTag />}<span className="text-xs text-slate-500"> {a?.primaryPosition} · {a?.gradYear}</span></td>
                            <td>{m ? <Badge tone={m.status === "sent" ? "green" : m.status === "approved" ? "blue" : m.status === "blocked" ? "red" : "amber"} title={m.status_reason ?? ""}>{m.status.replace("_", " ")}</Badge> : <span className="text-xs text-slate-400">awaiting list approval</span>}</td>
                            <td>
                              <form action={campTargetStatusAction} className="flex gap-1">
                                <input type="hidden" name="campId" value={camp.id} /><input type="hidden" name="athleteId" value={t.athlete_id} />
                                <Select name="status" defaultValue={t.status}>{["targeted", "invite_approved", "registered", "declined", "attended"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</Select>
                                <button className="text-xs text-brand-600">Save</button>
                              </form>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </Card>
            );
          })}
        </div>
        <Card title="Create a camp">
          <form action={createCampAction} className="space-y-2">
            <div><Label>Name</Label><Input name="name" required placeholder="Winter Prospect Camp" /></div>
            <div><Label>Date & time</Label><Input name="startsAt" type="datetime-local" required /></div>
            <div><Label>Location</Label><Input name="location" placeholder="Campus field" /></div>
            <div><Label>Registration link</Label><Input name="registrationUrl" type="url" placeholder="https://" /></div>
            <div><Label>Default targeting profile</Label><Select name="profileId" className="w-full"><option value="">None</option>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></div>
            <Button>Create camp</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
