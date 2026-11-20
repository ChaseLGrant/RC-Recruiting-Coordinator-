import Link from "next/link";
import { decideApprovalAction } from "@/app/actions";
import type { Approval, MessageRow } from "@/lib/repo/approvals";
import { timeAgo } from "./ui";

// Plain-language labels and buttons per item type, so a coach can decide in one tap.
const COPY: Record<Approval["kind"], { label: string; dot: string; yes: string; no: string }> = {
  prospect: { label: "New player for you", dot: "bg-emerald-500", yes: "Add to My Players", no: "Not interested" },
  board_change: { label: "Board change", dot: "bg-brand-500", yes: "Approve", no: "Decline" },
  outreach: { label: "Message ready for review", dot: "bg-brand-500", yes: "Approve message", no: "Discard" },
  camp_list: { label: "Camp invite list", dot: "bg-violet-500", yes: "Approve list", no: "Decline" },
  itinerary: { label: "Scouting trip idea", dot: "bg-sky-500", yes: "Save itinerary", no: "Dismiss" },
  data_conflict: { label: "Numbers don't match", dot: "bg-amber-500", yes: "Got it", no: "Dismiss" },
  compliance: { label: "Compliance check", dot: "bg-rose-500", yes: "Clear to send", no: "Hold" },
  contact_found: { label: "Contact info found", dot: "bg-sky-500", yes: "Save to profile", no: "Don't save" },
};

export function ApprovalCard({ a, message, returnTo = "/", canDecide, canDecideCompliance }: { a: Approval; message?: MessageRow; returnTo?: string; canDecide: boolean; canDecideCompliance: boolean }) {
  const allowed = a.kind === "compliance" ? canDecideCompliance : canDecide;
  const c = COPY[a.kind];
  const dup = a.kind === "data_conflict" && a.payload.type === "possible_duplicate";
  return (
    <article className="border border-slate-900/10 bg-white p-4 sm:p-5">
      <div className="eyebrow mb-2 flex items-center gap-2 text-slate-500">
        <span className={`h-2 w-2 rounded-full ${c.dot}`} />
        {dup ? "Possible duplicate" : c.label}
        {a.status === "saved" && <span className="rounded-[3px] bg-slate-100 px-2 py-0.5">Saved for later</span>}
        <span className="ml-auto font-normal">{timeAgo(a.createdAt)}</span>
      </div>
      <h3 className="text-[16px] font-bold leading-snug text-slate-900">
        {a.athleteId ? <Link href={`/athletes/${a.athleteId}`} className="hover:text-brand-700">{a.title}</Link> : a.title}
      </h3>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">{a.summary}</p>
      {allowed ? (
        <form action={decideApprovalAction} className="mt-3">
          <input type="hidden" name="approvalId" value={a.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          {message && (
            <details className="mb-3 rounded-[4px] bg-slate-50 p-3">
              <summary className="text-sm font-medium text-brand-700">Read or edit the message to {message.to_email ?? "(no email on file)"}</summary>
              <label className="mt-3 block text-xs font-medium text-slate-500" htmlFor={`s-${a.id}`}>Subject</label>
              <input id={`s-${a.id}`} name="subject" defaultValue={message.subject} className="mt-1 w-full rounded-[4px] border border-slate-200 bg-white px-3 py-2 text-sm" />
              <label className="mt-2 block text-xs font-medium text-slate-500" htmlFor={`b-${a.id}`}>Message</label>
              <textarea id={`b-${a.id}`} name="body" defaultValue={message.body} rows={8} className="mt-1 w-full rounded-[4px] border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed" />
            </details>
          )}
          <div className="flex flex-wrap gap-2">
            <button name="decision" value="approve" className="rounded-[3px] bg-brand-600 px-4 py-2 text-[12px] font-bold uppercase tracking-[0.06em] text-white hover:bg-brand-700">{dup ? "Merge records" : c.yes}</button>
            <button name="decision" value="reject" className="rounded-[3px] px-4 py-2 text-[12px] font-bold uppercase tracking-[0.06em] text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50">{dup ? "Keep separate" : c.no}</button>
            {a.status !== "saved" && <button name="decision" value="save" className="rounded-[3px] px-3 py-2 text-[12px] font-bold uppercase tracking-[0.06em] text-slate-500 hover:bg-slate-100">Later</button>}
          </div>
        </form>
      ) : (
        <p className="mt-2 text-xs text-slate-500">{a.kind === "compliance" ? "Waiting on your compliance office." : "Your role can view this but not decide it."}</p>
      )}
    </article>
  );
}
