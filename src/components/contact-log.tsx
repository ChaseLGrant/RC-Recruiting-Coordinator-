import { logContactAction } from "@/app/actions";
import { CONTACT_KINDS, type ContactKind } from "@/lib/repo/contacts";

const QUICK: ContactKind[] = ["call", "text", "email", "dm", "saw_play", "camp", "campus_visit", "in_person", "they_reached_out"];

/** One-tap contact logging: tap what happened; date and note are optional. */
export function LogContactForm({ athleteId, returnTo, compact }: { athleteId: string; returnTo: string; compact?: boolean }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <form action={logContactAction} className="space-y-3">
      <input type="hidden" name="athleteId" value={athleteId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className="flex flex-wrap gap-2">
        {(compact ? QUICK.slice(0, 5) : QUICK).map((k) => (
          <button key={k} name="kind" value={k} className="rounded-[3px] border border-slate-300 bg-white px-3 py-2 text-[13px] font-semibold text-slate-800 transition hover:border-[var(--team-primary)] hover:text-[var(--team-primary)] active:bg-brand-50">
            {CONTACT_KINDS[k].label}
          </button>
        ))}
      </div>
      {!compact && (
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <label htmlFor={`note-${athleteId}`} className="sr-only">Note (optional)</label>
          <input id={`note-${athleteId}`} name="note" placeholder="Optional note, e.g. talked with dad, interested in visiting" className="w-full rounded-[3px] border border-slate-200 px-3 py-2 text-sm" />
          <label htmlFor={`date-${athleteId}`} className="sr-only">Date</label>
          <input id={`date-${athleteId}`} name="date" type="date" defaultValue={today} max={today} className="rounded-[3px] border border-slate-200 px-3 py-2 text-sm" />
        </div>
      )}
      <p className="text-xs text-slate-500">Type a note first if you like, then tap what happened. It&apos;s logged under your name.</p>
    </form>
  );
}
