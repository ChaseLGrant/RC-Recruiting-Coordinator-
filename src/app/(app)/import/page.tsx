import { requireSession } from "@/lib/session";
import { stageListAction } from "@/app/actions";
import { Button, Flash, Input, Label, PageHeader } from "@/components/ui";

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ flash?: string; error?: string }> }) {
  await requireSession();
  const sp = await searchParams;
  return (
    <div className="mx-auto max-w-3xl">
      <Flash flash={sp.flash} error={sp.error} />
      <PageHeader title="Bring in your list" subtitle="Already tracking recruits in a spreadsheet? Bring it in as is. RC matches your columns, keeps your notes, and puts everyone in My Players." />
      <form action={stageListAction} className="grid gap-6 border border-slate-900/10 border-t-4 border-t-[var(--team-primary)] bg-white p-6">
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <div className="eyebrow mb-2 text-slate-500">Upload a file</div>
            <Label>CSV or Excel (.xlsx)</Label>
            <Input name="file" type="file" accept=".csv,.xlsx,.tsv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
          </div>
          <div>
            <div className="eyebrow mb-2 text-slate-500">Or use a Google Sheet</div>
            <Label>Paste the sheet&apos;s link</Label>
            <Input name="sheetUrl" type="url" placeholder="https://docs.google.com/spreadsheets/d/…" />
            <p className="mt-1 text-xs text-slate-500">Set sharing to &ldquo;Anyone with the link can view&rdquo; first, or download it as CSV and upload that.</p>
          </div>
        </div>
        <div><Label>Name this list (optional)</Label><Input name="listName" placeholder="e.g. 2027 Board, Fall Showcase Notes" /></div>
        <div className="flex flex-wrap items-center gap-3">
          <Button>Preview my list</Button>
          <span className="text-xs text-slate-500">Nothing is saved until you check the preview and confirm.</span>
        </div>
      </form>
      <div className="mt-6 grid gap-4 text-sm text-slate-600 sm:grid-cols-3">
        <div><b className="text-slate-900">Any column names.</b> &ldquo;Player&rdquo;, &ldquo;Pos&rdquo;, &ldquo;Grad&rdquo;, &ldquo;HS&rdquo;, &ldquo;Ht&rdquo;, &ldquo;EV&rdquo;: RC figures it out, and you can fix anything it misses.</div>
        <div><b className="text-slate-900">Your notes stay yours.</b> Notes and phone numbers become coach notes on each player. Priority or tier columns set their board status.</div>
        <div><b className="text-slate-900">Links keep working.</b> A MaxPreps or Perfect Game link column means RC keeps those players&apos; season stats updated automatically.</div>
      </div>
    </div>
  );
}
