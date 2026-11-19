import Link from "next/link";
import { requireSession } from "@/lib/session";
import { buildBrief } from "@/lib/services";
import { listMessages } from "@/lib/repo/approvals";
import { can } from "@/lib/domain/permissions";
import { completeTaskAction, markBriefReviewedAction } from "@/app/actions";
import { ApprovalCard } from "@/components/approval-card";
import { Badge, Button, Card, Empty, Flash, fmtDateTime, LinkButton, timeAgo } from "@/components/ui";
import { EVENT_TYPES } from "@/lib/domain/timesavings";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ flash?: string; error?: string }> }) {
  const { ctx, user, org } = await requireSession();
  const sp = await searchParams;
  const brief = await buildBrief(ctx.db, ctx.orgId, user.lastBriefAt);
  // Show what THIS user can decide first; items waiting on someone else go last.
  const decidable = (k: string) => (k === "compliance" ? can(user.role, "decide_compliance") : can(user.role, "decide_approvals"));
  brief.pendingApprovals.sort((x, y) => Number(decidable(y.kind)) - Number(decidable(x.kind)));
  const messages = new Map((await listMessages(ctx.db, ctx.orgId)).map((m) => [m.id, m]));
  const c = brief.counts;
  const tiles: Array<[string, number, string?]> = [
    ["New athletes matched", c.athlete_discovered ?? 0, "/discover"],
    ["Sources checked", c.source_checked ?? 0, "/settings#sources"],
    ["Profiles researched", c.athlete_researched ?? 0],
    ["Metrics updated", (c.metric_updated ?? 0) + (c.metric_verified ?? 0)],
    ["Games identified", (c.game_identified ?? 0) + (c.schedule_changed ?? 0), "/schedule"],
    ["Drafts prepared", c.draft_prepared ?? 0],
    ["Tasks organized", c.task_created ?? 0],
    ["Need your decision", brief.pendingApprovals.filter((a) => a.status === "pending").length, "/approvals"],
  ];
  const highlightTypes = ["athlete_discovered", "metric_updated", "schedule_changed", "game_identified", "conflict_detected", "job_failed", "import_completed", "source_checked", "draft_prepared", "task_created"] as const;
  const highlights = brief.events.filter((e) => (highlightTypes as readonly string[]).includes(e.type)).slice(0, 40);
  const nothingYet = brief.events.length === 0;

  return (
    <div>
      <Flash flash={sp.flash} error={sp.error} />
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">Good {greeting()}, {user.name.split(" ")[0]}.</p>
          <h1 className="text-2xl font-semibold tracking-tight">Here&apos;s what your recruiting staff accomplished</h1>
          <p className="text-sm text-slate-600">Since {user.lastBriefAt ? `your last briefing (${fmtDateTime(brief.since)})` : "the last 24 hours"} · every item below is a recorded system event.</p>
        </div>
        <div className="flex gap-2">
          <LinkButton href="/discover" variant="primary">New search</LinkButton>
          <form action={markBriefReviewedAction}><Button variant="secondary">Mark briefing reviewed</Button></form>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {tiles.map(([label, n, href]) => {
          const inner = (
            <div className={`h-full rounded-xl border bg-white p-3 ${label === "Need your decision" && n > 0 ? "border-rose-200 bg-rose-50" : "border-slate-200"}`}>
              <div className="text-2xl font-semibold tabular-nums">{n}</div>
              <div className="text-xs text-slate-600">{label}</div>
            </div>
          );
          return href ? <Link key={label} href={href}>{inner}</Link> : <div key={label}>{inner}</div>;
        })}
      </div>

      {brief.failedRuns.length > 0 && (
        <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <b>{brief.failedRuns.length} background job{brief.failedRuns.length > 1 ? "s" : ""} failed and need review.</b>
          <ul className="mt-1 list-disc pl-5">{brief.failedRuns.map((r) => <li key={r.id}>{r.mission_name ?? r.kind}: {r.error} ({timeAgo(r.started_at)})</li>)}</ul>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card title={<>Needs Your Approval <span className="ml-1 text-slate-400">({brief.pendingApprovals.length})</span></>} action={<Link href="/approvals" className="text-xs text-brand-600 hover:underline">View all →</Link>}>
            {brief.pendingApprovals.length === 0 ? (
              <Empty>Nothing waiting on you. RC will queue recommendations, drafts and conflicts here.</Empty>
            ) : (
              <div className="space-y-3">
                {brief.pendingApprovals.slice(0, 6).map((a) => (
                  <ApprovalCard key={a.id} a={a} message={a.payload.messageId ? messages.get(String(a.payload.messageId)) : undefined} canDecide={can(user.role, "decide_approvals")} canDecideCompliance={can(user.role, "decide_compliance")} />
                ))}
                {brief.pendingApprovals.length > 6 && <LinkButton href="/approvals">See {brief.pendingApprovals.length - 6} more</LinkButton>}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card title="Today's priorities">
            {brief.tasks.length === 0 ? <Empty>No open tasks.</Empty> : (
              <ul className="divide-y divide-slate-100">
                {brief.tasks.slice(0, 8).map((t) => (
                  <li key={t.id} className="flex items-start gap-2 py-2 text-sm">
                    <form action={completeTaskAction}><input type="hidden" name="taskId" value={t.id} /><button title="Mark done" className="mt-0.5 h-4 w-4 rounded border border-slate-400 hover:bg-emerald-100" /></form>
                    <div className="flex-1">
                      {t.athlete_id ? <Link href={`/athletes/${t.athlete_id}`} className="hover:underline">{t.title}</Link> : t.title}
                      <div className="text-xs text-slate-400">{t.origin === "mission" ? "Organized by RC" : "Added by staff"}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Activity log" action={<Badge>{brief.events.length} events</Badge>}>
            {nothingYet ? (
              <Empty>
                No recorded work yet.{" "}
                {org.isDemo ? "Run a mission to see RC work." : <>Import authorized data in <Link href="/settings#sources" className="underline">Settings</Link> and save a <Link href="/discover" className="underline">recurring search</Link>.</>}
              </Empty>
            ) : (
              <ul className="max-h-[32rem] space-y-2 overflow-y-auto text-sm">
                {highlights.map((e) => (
                  <li key={e.id} className="flex gap-2">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot(e.type)}`} />
                    <div>
                      <div className="text-slate-800">{e.athlete_id ? <Link href={`/athletes/${e.athlete_id}`} className="hover:underline">{e.message}</Link> : e.message}</div>
                      <div className="text-xs text-slate-400">{EVENT_TYPES[e.type] ?? e.type} · {timeAgo(e.created_at)}</div>
                    </div>
                  </li>
                ))}
                {brief.events.length > highlights.length && <li className="text-xs text-slate-400">+ {brief.events.length - highlights.length} routine checks (profiles re-checked, decisions logged)</li>}
              </ul>
            )}
          </Card>

          <Card title="Background jobs">
            {brief.recentRuns.length === 0 ? <Empty>No mission runs yet.</Empty> : (
              <ul className="space-y-1.5 text-sm">
                {brief.recentRuns.slice(0, 6).map((r) => {
                  const s = JSON.parse(r.stats_json || "{}") as { athletesEvaluated?: number; eligible?: number; newMatches?: number };
                  return (
                    <li key={r.id} className="flex items-center gap-2">
                      <Badge tone={r.status === "succeeded" ? "green" : r.status === "failed" ? "red" : "amber"}>{r.status}</Badge>
                      <span className="flex-1 truncate">{r.mission_name ?? r.kind}{r.status === "succeeded" && s.athletesEvaluated != null ? ` · ${s.eligible}/${s.athletesEvaluated} meet standards, ${s.newMatches} new` : r.error ? ` · ${r.error}` : ""}</span>
                      <span className="text-xs text-slate-400">{timeAgo(r.started_at)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

function dot(t: string) {
  if (t === "athlete_discovered") return "bg-emerald-500";
  if (t === "job_failed") return "bg-rose-600";
  if (t === "conflict_detected") return "bg-amber-500";
  if (t.startsWith("metric")) return "bg-blue-500";
  if (t.includes("game") || t.includes("schedule")) return "bg-violet-500";
  return "bg-slate-300";
}
