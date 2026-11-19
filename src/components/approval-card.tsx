import Link from "next/link";
import { decideApprovalAction } from "@/app/actions";
import { APPROVAL_KIND_LABEL, type Approval, type MessageRow } from "@/lib/repo/approvals";
import { Badge, Button, timeAgo } from "./ui";

const TONE: Record<Approval["kind"], "blue" | "green" | "amber" | "violet" | "red" | "slate"> = {
  prospect: "green", board_change: "blue", outreach: "blue", camp_list: "violet", itinerary: "slate", data_conflict: "amber", compliance: "red",
};

export function ApprovalCard({ a, message, returnTo = "/", canDecide, canDecideCompliance }: { a: Approval; message?: MessageRow; returnTo?: string; canDecide: boolean; canDecideCompliance: boolean }) {
  const allowed = a.kind === "compliance" ? canDecideCompliance : canDecide;
  const elig = a.payload.eligibility as { status: string; reasons: string[] } | undefined;
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Badge tone={TONE[a.kind]}>{APPROVAL_KIND_LABEL[a.kind]}</Badge>
        {a.status === "saved" && <Badge>Saved for later</Badge>}
        {elig && <Badge tone={elig.status === "eligible" ? "green" : elig.status === "blocked" ? "red" : "amber"}>Compliance: {elig.status.replace("_", " ")}</Badge>}
        <span className="ml-auto text-xs text-slate-400">{timeAgo(a.createdAt)}</span>
      </div>
      <h3 className="text-sm font-semibold text-slate-900">
        {a.athleteId ? <Link href={`/athletes/${a.athleteId}`} className="hover:underline">{a.title}</Link> : a.title}
      </h3>
      <p className="mt-1 text-sm text-slate-600">{a.summary}</p>
      {Array.isArray(a.payload.factsUsed) && (a.payload.factsUsed as string[]).length > 0 && (
        <p className="mt-1 text-xs text-slate-500">Facts used in draft: {(a.payload.factsUsed as string[]).join(" · ")}</p>
      )}
      {allowed ? (
        <form action={decideApprovalAction} className="mt-3">
          <input type="hidden" name="approvalId" value={a.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          {message && (
            <details className="mb-2 rounded-lg bg-slate-50 p-2">
              <summary className="text-xs font-medium text-brand-700">View / edit draft to {message.to_email ?? "(no email on record)"}</summary>
              <input name="subject" defaultValue={message.subject} className="mt-2 w-full rounded border border-slate-300 px-2 py-1 text-sm" />
              <textarea name="body" defaultValue={message.body} rows={9} className="mt-2 w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs" />
            </details>
          )}
          <div className="flex flex-wrap gap-2">
            <Button name="decision" value="approve" variant="success">Approve</Button>
            <Button name="decision" value="reject" variant="danger">Reject</Button>
            {a.status !== "saved" && <Button name="decision" value="save" variant="ghost">Save for later</Button>}
          </div>
        </form>
      ) : (
        <p className="mt-2 text-xs text-slate-500">{a.kind === "compliance" ? "Waiting on your compliance officer." : "Your role can view but not decide this item."}</p>
      )}
    </article>
  );
}
