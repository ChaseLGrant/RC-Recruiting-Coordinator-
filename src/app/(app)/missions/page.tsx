import Link from "next/link";
import { requireSession } from "@/lib/session";
import { listJobRuns, listMissions, listProfiles } from "@/lib/repo";
import { listCamps } from "@/lib/repo/approvals";
import { describeCriteria } from "@/lib/domain/criteria";
import { encodeCriteria } from "@/lib/criteria-form";
import { deleteMissionAction, deleteProfileAction, runMissionAction, toggleMissionAction } from "@/app/actions";
import { Badge, Button, Card, Empty, Flash, PageHeader, fmtDateTime, timeAgo } from "@/components/ui";

export default async function MissionsPage({ searchParams }: { searchParams: Promise<{ flash?: string; error?: string }> }) {
  const { ctx } = await requireSession();
  const sp = await searchParams;
  const [profiles, missions, runs, camps] = await Promise.all([listProfiles(ctx.db, ctx.orgId), listMissions(ctx.db, ctx.orgId), listJobRuns(ctx.db, ctx.orgId, 30), listCamps(ctx.db, ctx.orgId)]);
  const profileName = new Map(profiles.map((p) => [p.id, p.name]));
  const campName = new Map(camps.map((c) => [c.id, c.name]));
  return (
    <div>
      <Flash flash={sp.flash} error={sp.error} />
      <PageHeader title="Missions & recruiting profiles" subtitle="Your saved standards and the recurring work RC does on them. The worker process runs due missions automatically." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Recurring missions">
          {missions.length === 0 ? <Empty>No missions. Run a search in <Link href="/discover" className="underline">Discover</Link> and save it as a recurring mission.</Empty> : (
            <ul className="space-y-3">
              {missions.map((m) => (
                <li key={m.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="text-sm">{m.name}</b>
                    <Badge tone={m.active ? "green" : "slate"}>{m.active ? "Active" : "Paused"}</Badge>
                    <Badge>{m.schedule}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-slate-600">
                    Profile: {profileName.get(m.profileId) ?? "deleted"} · {[m.actions.discover && "discover", m.actions.monitorGames && "monitor games", m.actions.prepareCampInvites && `camp invites (${campName.get(m.actions.campId ?? "") ?? "camp"})`].filter(Boolean).join(" · ")}
                  </div>
                  <div className="text-xs text-slate-500">Last run {timeAgo(m.lastRunAt)} · Next run {m.active && m.nextRunAt ? fmtDateTime(m.nextRunAt) : "—"}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <form action={runMissionAction}><input type="hidden" name="missionId" value={m.id} /><Button className="text-xs">Run now</Button></form>
                    <form action={toggleMissionAction}><input type="hidden" name="missionId" value={m.id} /><input type="hidden" name="active" value={m.active ? "0" : "1"} /><Button variant="secondary" className="text-xs">{m.active ? "Pause" : "Resume"}</Button></form>
                    <form action={deleteMissionAction}><input type="hidden" name="missionId" value={m.id} /><Button variant="danger" className="text-xs">Delete</Button></form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Saved recruiting profiles">
          {profiles.length === 0 ? <Empty>No saved profiles yet.</Empty> : (
            <ul className="space-y-3">
              {profiles.map((p) => (
                <li key={p.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-2"><b className="text-sm">{p.name}</b>
                    <div className="flex gap-2">
                      <Link href={`/discover?c=${encodeCriteria(p.criteria)}`} className="text-xs text-brand-600 hover:underline">Open in Discover</Link>
                      <form action={deleteProfileAction}><input type="hidden" name="profileId" value={p.id} /><button className="text-xs text-slate-400 hover:text-rose-600">Delete</button></form>
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">{describeCriteria(p.criteria).map((d) => <Badge key={d}>{d}</Badge>)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card title="Background job history" className="mt-6">
        {runs.length === 0 ? <Empty>No runs yet.</Empty> : (
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Started</th><th>Mission</th><th>Trigger</th><th>Status</th><th>Result</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {runs.map((r) => {
                const s = JSON.parse(r.stats_json || "{}") as { athletesEvaluated?: number; eligible?: number; newMatches?: number; sourcesChecked?: number; sourcesFailed?: number; upcomingGames?: number; campListSize?: number };
                return (
                  <tr key={r.id}>
                    <td className="py-1.5 text-xs">{fmtDateTime(r.started_at)}</td>
                    <td>{r.mission_name ?? r.kind}</td>
                    <td className="text-xs">{r.trigger}</td>
                    <td><Badge tone={r.status === "succeeded" ? "green" : r.status === "failed" ? "red" : "amber"}>{r.status}</Badge></td>
                    <td className="text-xs text-slate-600">{r.status === "failed" ? r.error : `${s.sourcesChecked ?? 0} sources checked${s.sourcesFailed ? ` (${s.sourcesFailed} failed)` : ""} · ${s.eligible ?? 0}/${s.athletesEvaluated ?? 0} meet standards · ${s.newMatches ?? 0} new · ${s.upcomingGames ?? 0} upcoming games${s.campListSize ? ` · ${s.campListSize} camp targets` : ""}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
