import { requireSession } from "@/lib/session";
import { addPlayerAction } from "@/app/actions";
import { Button, Flash, Input, Label, PageHeader, Select } from "@/components/ui";

const POS = ["SS", "2B", "3B", "1B", "C", "CF", "OF", "RHP", "LHP", "UTIL"];

export default async function AddPlayerPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireSession();
  const sp = await searchParams;
  const y = new Date().getFullYear();
  return (
    <div className="mx-auto max-w-2xl">
      <Flash error={sp.error} />
      <PageHeader title="Add a player" subtitle="Saw someone you like? Put him on the board in seconds. Only the name is required. RC fills in the rest by finding his stat pages and socials for you to approve." />
      <form action={addPlayerAction} className="space-y-6 border border-slate-900/10 border-t-4 border-t-[var(--team-primary)] bg-white p-5 sm:p-6">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>First name *</Label><Input name="firstName" required autoComplete="off" /></div>
          <div><Label>Last name *</Label><Input name="lastName" required autoComplete="off" /></div>
          <div><Label>Class</Label><Select name="gradYear" defaultValue="" className="w-full"><option value="">—</option>{[y, y + 1, y + 2, y + 3, y + 4].map((g) => <option key={g} value={g}>{g}</option>)}</Select></div>
          <div><Label>Position</Label><Select name="position" defaultValue="" className="w-full"><option value="">—</option>{POS.map((p) => <option key={p} value={p}>{p}</option>)}</Select></div>
          <div className="col-span-2"><Label>High school</Label><Input name="school" /></div>
          <div><Label>City</Label><Input name="city" /></div>
          <div><Label>State</Label><Input name="state" placeholder="CA" maxLength={20} /></div>
          <div className="col-span-2"><Label>Travel / club team</Label><Input name="team" /></div>
        </div>

        <div>
          <div className="eyebrow mb-2 text-slate-500">What you saw (optional)</div>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            <div><Label>Height</Label><Input name="height" placeholder={`6'1"`} /></div>
            <div><Label>Weight</Label><Input name="weight" inputMode="numeric" placeholder="185" /></div>
            <div><Label>Exit velo</Label><Input name="ev" inputMode="decimal" placeholder="92" /></div>
            <div><Label>60 time</Label><Input name="sixty" inputMode="decimal" placeholder="6.85" /></div>
            <div><Label>FB velo</Label><Input name="fb" inputMode="decimal" placeholder="88" /></div>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
            <div><Label>Where did you see him?</Label><Input name="seenAt" placeholder="e.g. PG West Fall Classic, Field 3" /></div>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="sawPlay" value="1" defaultChecked className="h-5 w-5 accent-[var(--team-primary)]" /> Log &ldquo;Saw him play&rdquo;</label>
          </div>
          <p className="mt-2 text-xs text-slate-500">Numbers you enter are labeled &ldquo;seen by&rdquo; you, so the staff always knows where they came from.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>Phone</Label><Input name="phone" type="tel" placeholder="(760) 555-0101" /></div>
          <div><Label>X handle</Label><Input name="xHandle" placeholder="@handle" /></div>
          <div className="sm:col-span-2"><Label>Links (MaxPreps, Perfect Game, Hudl…), if you have them</Label><Input name="links" placeholder="Paste one or more links" /></div>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div><Label>Note for the staff</Label><textarea name="note" rows={2} className="w-full rounded-[3px] border border-slate-200 px-3 py-2 text-sm" placeholder="What stood out?" /></div>
          <div><Label>Board</Label><Select name="boardStatus" defaultValue="watching" className="w-full"><option value="priority">Priority</option><option value="evaluating">Evaluating</option><option value="watching">Watching</option></Select></div>
        </div>

        <Button className="w-full sm:w-auto">Add to My Players</Button>
      </form>
    </div>
  );
}
