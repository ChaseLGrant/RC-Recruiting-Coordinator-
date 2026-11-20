import { requireSession } from "@/lib/session";
import { listApprovals, listMessages, APPROVAL_KIND_LABEL, type ApprovalKind } from "@/lib/repo/approvals";
import { can } from "@/lib/domain/permissions";
import { listCandidates } from "@/lib/finder/finder";
import { ApprovalCard } from "@/components/approval-card";
import { Badge, Empty, Flash, PageHeader, timeAgo } from "@/components/ui";
import Link from "next/link";

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ kind?: string; flash?: string; error?: string; view?: string }> }) {
  const { ctx, user } = await requireSession();
  const sp = await searchParams;
  const decided = sp.view === "decided";
  const all = await listApprovals(ctx.db, ctx.orgId, decided ? ["approved", "rejected"] : ["pending", "saved"]);
  const items = sp.kind ? all.filter((a) => a.kind === sp.kind) : all;
  const messages = new Map((await listMessages(ctx.db, ctx.orgId)).map((m) => [m.id, m]));
  const candIds = items.filter((x) => x.kind === "links_found").flatMap((x) => (x.payload.candidateIds as string[]) ?? []);
  const cands = await listCandidates(ctx.db, ctx.orgId, { ids: candIds });
  const kinds = Array.from(new Set(all.map((a) => a.kind)));
  const returnTo = `/approvals${sp.kind ? `?kind=${sp.kind}` : ""}`;
  return (
    <div>
      <Flash flash={sp.flash} error={sp.error} />
      <PageHeader title="Needs your OK" subtitle="Nothing RC prepares happens until you decide. Messages are never sent automatically." />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Link href="/approvals" className={`rounded-[3px] px-3 py-1 ${!sp.kind && !decided ? "bg-brand-600 text-white" : "bg-white ring-1 ring-slate-200"}`}>All open</Link>
        {!decided && kinds.map((k) => (
          <Link key={k} href={`/approvals?kind=${k}`} className={`rounded-[3px] px-3 py-1 ${sp.kind === k ? "bg-brand-600 text-white" : "bg-white ring-1 ring-slate-200"}`}>
            {APPROVAL_KIND_LABEL[k as ApprovalKind]} ({all.filter((a) => a.kind === k).length})
          </Link>
        ))}
        <Link href="/approvals?view=decided" className={`ml-auto rounded-[3px] px-3 py-1 ${decided ? "bg-slate-800 text-white" : "bg-white ring-1 ring-slate-200"}`}>Decision history</Link>
      </div>
      {items.length === 0 ? <Empty>Nothing here.</Empty> : decided ? (
        <ul className="divide-y divide-slate-200 rounded-[4px] border border-slate-200 bg-white">
          {items.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
              <Badge tone={a.status === "approved" ? "green" : "red"}>{a.status}</Badge>
              <span className="flex-1">{a.title}</span>
              <span className="text-xs text-slate-400">{APPROVAL_KIND_LABEL[a.kind]} · decided {timeAgo(a.decidedAt)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((a) => (
            <ApprovalCard key={a.id} a={a} returnTo={returnTo} message={a.payload.messageId ? messages.get(String(a.payload.messageId)) : undefined} canDecide={can(user.role, "decide_approvals")} canDecideCompliance={can(user.role, "decide_compliance")} candidates={a.kind === "links_found" ? cands.filter((c) => ((a.payload.candidateIds as string[]) ?? []).includes(c.id)) : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}
