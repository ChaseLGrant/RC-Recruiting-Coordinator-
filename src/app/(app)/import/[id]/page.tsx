import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { getStagedImport } from "@/lib/import/service";
import { FIELDS, applyMapping } from "@/lib/import/mapping";
import { confirmListAction } from "@/app/actions";
import { Button, Flash, PageHeader } from "@/components/ui";

export default async function ImportPreviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; from?: string }> }) {
  const { ctx } = await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  const staged = await getStagedImport(ctx.db, ctx.orgId, id);
  if (!staged) notFound();
  const preview = applyMapping(staged.headers, staged.rows, staged.suggested, staged.listName);
  const matched = staged.suggested.filter((f) => f !== "ignore").length;
  return (
    <div>
      <Flash error={sp.error} />
      <PageHeader title="Check your columns" subtitle={<>RC read <b>{staged.rows.length}</b> players from &ldquo;{staged.listName}&rdquo; and matched <b>{matched}</b> of {staged.headers.length} columns. Fix anything that&apos;s wrong, then import.</>} />
      {sp.from === "photo" && <p className="mb-4 border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-950">Read from your photo. Check the names and numbers below against the page. Blank cells are ones RC couldn&apos;t read clearly.</p>}
      <form action={confirmListAction}>
        <input type="hidden" name="importId" value={staged.id} />
        <input type="hidden" name="columnCount" value={staged.headers.length} />
        <div className="overflow-x-auto border border-slate-900/10 bg-white">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {staged.headers.map((h, i) => (
                  <th key={i} className="min-w-[11rem] px-3 py-3 text-left align-top">
                    <div className="eyebrow mb-1.5 truncate text-slate-500" title={h}>Your column: {h}</div>
                    <label htmlFor={`col_${i}`} className="sr-only">RC field for {h}</label>
                    <select id={`col_${i}`} name={`col_${i}`} defaultValue={staged.suggested[i]} className={`w-full rounded-[3px] border px-2 py-1.5 text-sm font-normal ${staged.suggested[i] === "ignore" ? "border-slate-200 text-slate-400" : "border-[var(--team-primary)] text-slate-900"}`}>
                      {FIELDS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                    </select>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {staged.rows.slice(0, 8).map((r, ri) => (
                <tr key={ri}>{r.map((c, ci) => <td key={ci} className={`max-w-[14rem] truncate px-3 py-2 ${staged.suggested[ci] === "ignore" ? "text-slate-400" : ""}`} title={c}>{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        {staged.rows.length > 8 && <p className="mt-2 text-xs text-slate-500">Showing 8 of {staged.rows.length} rows.</p>}
        {preview.warnings.length > 0 && <ul className="mt-4 list-disc space-y-1 border-l-4 border-amber-500 bg-white py-3 pl-8 pr-4 text-sm text-amber-900">{preview.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Button>Import {preview.rows.length || staged.rows.length} players</Button>
          <Link href="/import" className="text-sm text-slate-500 underline">Start over</Link>
          <span className="text-xs text-slate-500">Players already in RC are matched, not duplicated. Numbers from your list are labeled as coming from it.</span>
        </div>
      </form>
    </div>
  );
}
