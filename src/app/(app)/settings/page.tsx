import { requireSession } from "@/lib/session";
import { listAudit, listSources, listUsers } from "@/lib/repo";
import { PROVIDERS } from "@/lib/providers/registry";
import { ATHLETE_CSV_COLUMNS, SCHEDULE_CSV_COLUMNS } from "@/lib/providers/csv";
import { getEmailProvider } from "@/lib/providers/email";
import { getAiProvider } from "@/lib/ai/provider";
import { listTrackedPages } from "@/lib/watch/runner";
import { can } from "@/lib/domain/permissions";
import { ROLE_LABEL, type Role } from "@/lib/domain/types";
import { setSharedLoginAction, addStaffProfileAction, updateStatTrackingAction, checkPagesNowAction, updateBrandingAction, importCsvAction, inviteUserAction, syncSourcesAction, updateComplianceAction, updateOutreachSettingsAction, updateProgramAction } from "@/app/actions";
import { Badge, Button, Card, Flash, Input, Label, PageHeader, Select, fmtDateTime, timeAgo } from "@/components/ui";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ flash?: string; error?: string }> }) {
  const { ctx, user, org } = await requireSession();
  const sp = await searchParams;
  const sources = await listSources(ctx.db, ctx.orgId);
  const tracked = await listTrackedPages(ctx.db, ctx.orgId);
  const users = await listUsers(ctx.db, ctx.orgId);
  const sharedLogin = await ctx.db.get<{ email: string }>("SELECT email FROM users WHERE org_id = ? AND is_shared = 1", [ctx.orgId]);
  const audit = can(user.role, "view_audit") ? await listAudit(ctx, 60) : [];
  const comp = org.settings.compliance;
  const yr = new Date().getFullYear();
  const email = getEmailProvider();
  const ai = getAiProvider();
  const canSettings = can(user.role, "manage_settings");

  return (
    <div className="space-y-6">
      <Flash flash={sp.flash} error={sp.error} />
      <PageHeader title="Settings" />

      <Card title="Program">
        <form action={updateProgramAction} className="grid gap-3 md:grid-cols-3">
          <div><Label>Program name</Label><Input name="name" defaultValue={org.name} /></div>
          <div><Label>Campus location (ZIP or City, ST) — used for radius searches</Label><Input name="campus" defaultValue={org.campus?.label.replace(/^Campus \(|\)$/g, "") ?? ""} required /></div>
          <div className="flex items-end"><Button disabled={!canSettings}>Save</Button></div>
        </form>
        {org.campus && <p className="mt-2 text-xs text-slate-500">Geocoded to {org.campus.lat.toFixed(4)}, {org.campus.lng.toFixed(4)} (US ZIP centroid data, offline).</p>}
      </Card>

      <Card title="Branding" id="branding">
        <form action={updateBrandingAction} className="grid gap-4 md:grid-cols-[auto_1fr]">
          <div className="grid h-28 w-28 place-items-center border border-slate-200 bg-[var(--team-ink)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {org.settings.branding.logoDataUrl ? <img src={org.settings.branding.logoDataUrl} alt="Current logo" className="h-20 w-20 object-contain" /> : <span className="px-2 text-center text-[11px] text-white/60">No logo yet</span>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>Team name in the header</Label><Input name="teamName" defaultValue={org.settings.branding.teamName ?? ""} placeholder="e.g. Palomar Baseball" /></div>
            <div><Label>Logo (PNG, JPG, WebP or SVG, under 500 KB)</Label><Input name="logo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" /></div>
            <div className="flex gap-3">
              <label className="text-xs font-medium text-slate-600">Main color<input name="primary" type="color" defaultValue={org.settings.branding.primary} className="mt-1 block h-10 w-16 cursor-pointer border border-slate-200" /></label>
              <label className="text-xs font-medium text-slate-600">Header color<input name="ink" type="color" defaultValue={org.settings.branding.ink} className="mt-1 block h-10 w-16 cursor-pointer border border-slate-200" /></label>
              <label className="text-xs font-medium text-slate-600">Accent color<input name="accent" type="color" defaultValue={org.settings.branding.accent} className="mt-1 block h-10 w-16 cursor-pointer border border-slate-200" /></label>
            </div>
            <div className="flex items-end gap-3">
              {org.settings.branding.logoDataUrl && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="removeLogo" value="1" /> Remove logo</label>}
              <Button disabled={!canSettings}>Save branding</Button>
            </div>
          </div>
        </form>
      </Card>

      <Card title="Data sources" id="sources" action={<form action={syncSourcesAction}><Button variant="secondary" className="text-xs">Check connected sources now</Button></form>}>
        <p className="mb-3 text-sm text-slate-600"><b>Have a recruiting spreadsheet?</b> Use <a href="/import" className="font-semibold text-brand-700 underline">Import your list</a>. It reads any column names, Excel files and Google Sheets. The form below is for files already in RC&apos;s template format.</p>
        <p className="mb-3 text-sm text-slate-600">RC works from three kinds of data: lists and files your staff bring in, public stats pages your staff link to players (kept updated automatically; see Season stat tracking), and licensed data feeds once connected. It never logs in to other sites or gets around a paywall.</p>
        <table className="mb-5 min-w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Source</th><th>Type</th><th>Status</th><th>Details</th><th>Last checked</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {sources.map((s) => (
              <tr key={s.id}>
                <td className="py-1.5 font-medium">{s.name}</td>
                <td className="text-xs">{s.kind.replace("_", " ")}</td>
                <td><Badge tone={s.status === "connected" ? "green" : s.status === "error" ? "red" : s.status === "import_only" ? "blue" : "slate"}>{s.status.replace("_", " ")}</Badge></td>
                <td className="max-w-md text-xs text-slate-600">{s.statusDetail}</td>
                <td className="text-xs text-slate-500">{timeAgo(s.lastCheckedAt ?? s.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid gap-4 md:grid-cols-2">
          <form action={importCsvAction} className="space-y-2 rounded-[4px] border border-slate-200 p-3">
            <div className="text-sm font-semibold">Import a CSV</div>
            <div className="flex gap-3 text-sm">
              <label className="flex items-center gap-1"><input type="radio" name="kind" value="athletes" defaultChecked /> Athletes & measurements</label>
              <label className="flex items-center gap-1"><input type="radio" name="kind" value="schedule" /> Game schedules</label>
            </div>
            <div><Label>Source name (shown next to every value)</Label><Input name="sourceName" placeholder="e.g. 2026 Summer Camp results" /></div>
            <Input name="file" type="file" accept=".csv,text/csv" required />
            <label className="flex items-start gap-2 text-xs text-slate-700"><input type="checkbox" name="attest" value="1" className="mt-0.5" /> I confirm our program is authorized to use this data (our own evaluations, our camp results, or a licensed export) and that verification labels in the file are accurate.</label>
            <Button disabled={!can(user.role, "import_data")}>Import</Button>
          </form>
          <div className="rounded-[4px] bg-slate-50 p-3 text-xs text-slate-600">
            <div className="mb-1 font-semibold text-slate-800">CSV columns</div>
            <p><b>Athletes:</b> {ATHLETE_CSV_COLUMNS.join(", ")}.</p>
            <p className="mt-1">Required: first_name, last_name. <code>verification</code> is one of independently_verified, official, self_reported, unverified (default unverified). <code>height</code> accepts 5&apos;10&quot;.</p>
            <p className="mt-2"><b>Schedules:</b> {SCHEDULE_CSV_COLUMNS.join(", ")}. Rows are matched to athletes already in RC.</p>
          </div>
        </div>
        <div className="mt-4 text-xs text-slate-500">
          Available providers: {PROVIDERS.map((p) => `${p.name} (${p.status(process.env, org).status.replace("_", " ")})`).join(" · ")}.{" "}
          AI search assist: {ai ? `${ai.name} connected (used only to read your search request)` : "not configured — RC uses its built-in rule-based parser"}.
        </div>
      </Card>

      <Card title="Season stat tracking" id="stat-tracking" action={<form action={checkPagesNowAction}><Button variant="secondary" className="text-xs">Check all now</Button></form>}>
        <p className="mb-3 text-sm text-slate-600">Link a player&apos;s public stats page once (on their profile, or a <code>profile_url</code> column in your CSV) and RC re-checks it automatically all season. Changes show up in your daily summary. RC reads only pages your staff linked, identifies itself, goes slowly, follows each site&apos;s robots.txt, and never logs in or gets around a paywall.</p>
        <p className="mb-3 text-sm"><b>{tracked.length}</b> pages linked · <b>{tracked.filter((t) => t.status === "ok").length}</b> updating normally · <b>{tracked.filter((t) => !["ok", "pending"].includes(t.status)).length}</b> need attention</p>
        <form action={updateStatTrackingAction} className="flex flex-wrap items-end gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" name="enabled" value="1" defaultChecked={org.settings.pageWatch.enabled} /> Keep stats updated automatically</label>
          <label className="flex items-center gap-2">Check every
            <Select name="everyHours" defaultValue={String(org.settings.pageWatch.everyHours)}>{[6, 12, 24, 48, 168].map((h) => <option key={h} value={h}>{h === 168 ? "week" : `${h} hours`}</option>)}</Select>
          </label>
          <Button disabled={!canSettings}>Save</Button>
        </form>
      </Card>

      <Card title="Compliance" id="compliance">
        <form action={updateComplianceAction} className="space-y-3 text-sm">
          <p className="text-slate-600">RC does not hard-code NCAA rules. Your compliance office sets them here. Until they do, every outreach draft goes to compliance review.</p>
          <label className="flex items-center gap-2"><input type="checkbox" name="configured" value="1" defaultChecked={comp.configured} /> These settings have been reviewed by our compliance office</label>
          <div className="grid gap-3 md:grid-cols-3">
            <div><Label>Division / association</Label><Input name="division" defaultValue={comp.division ?? ""} placeholder="NCAA Division I" /></div>
            {[yr, yr + 1, yr + 2, yr + 3].map((y) => (
              <div key={y}><Label>Class of {y}: first permitted contact date</Label><Input name={`firstContact_${y}`} type="date" defaultValue={comp.firstContactDateByGradYear[String(y)] ?? ""} /></div>
            ))}
          </div>
          <div><Label>Recruiting calendar (one per line: start, end, type [contact|evaluation|quiet|dead], note)</Label>
            <textarea name="calendar" rows={4} className="w-full rounded-[4px] border border-slate-300 p-2 font-mono text-xs" defaultValue={comp.calendar.map((p) => [p.start, p.end, p.type, p.note ?? ""].join(", ")).join("\n")} placeholder="2026-12-20, 2027-01-03, dead, Winter dead period" />
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" name="requireGuardianConsent" value="1" defaultChecked={comp.requireGuardianConsentForMinors} /> Require recorded parent/guardian consent before messaging athletes under 18 (or of unknown age)</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="campMaterialsAllowed" value="1" defaultChecked={comp.campMaterialsAllowedBeforeContactDate} /> Camp invitations may go out before the permitted contact date (per our compliance office)</label>
          <Button disabled={!canSettings}>Save compliance settings</Button>
        </form>
      </Card>

      <Card title="Outreach" id="outreach">
        <form action={updateOutreachSettingsAction} className="space-y-3 text-sm">
          <div><Label>Program name used in messages</Label><Input name="programDisplayName" defaultValue={org.settings.programDisplayName ?? org.name} /></div>
          <label className="flex items-center gap-2"><input type="checkbox" name="emailSendingEnabled" value="1" defaultChecked={org.settings.emailSendingEnabled} /> Allow coaches to send approved messages from RC</label>
          <p className="text-xs text-slate-500">Email provider: {email ? `${email.name} connected` : "none connected (set RESEND_API_KEY and RC_EMAIL_FROM). Approved messages can be opened in your own email client."} Even when enabled, RC never sends automatically — every send is a coach&apos;s click after approval and compliance checks.</p>
          <Button disabled={!canSettings}>Save</Button>
        </form>
      </Card>

      <Card title="Staff & login" id="team">
        <div className="mb-5 border-l-4 border-[var(--team-primary)] bg-slate-50 p-4 text-sm">
          <div className="font-semibold">One login for the whole staff</div>
          <p className="mt-1 text-slate-600">Everyone signs in with the same staff email and password, then taps their name. Notes and contacts are still credited to the right coach.{sharedLogin ? <> Current staff login: <b>{sharedLogin.email}</b>.</> : " Not set up yet."}</p>
          {can(user.role, "manage_users") && (
            <form action={setSharedLoginAction} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input name="email" type="email" placeholder="Staff login email" defaultValue={sharedLogin?.email ?? ""} required />
              <Input name="password" type="password" placeholder={sharedLogin ? "New staff password" : "Staff password (8+ characters)"} minLength={8} required />
              <Button>{sharedLogin ? "Update" : "Set up"}</Button>
            </form>
          )}
        </div>
        <ul className="mb-4 divide-y divide-slate-100 text-sm">
          {users.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-3 py-2">
              <span><b className="font-semibold">{u.name}</b>{u.title && <span className="text-slate-500"> · {u.title}</span>}{!u.email.endsWith("@staff.rc.local") && <span className="block text-xs text-slate-400">Personal login: {u.email}</span>}</span>
              <Badge>{ROLE_LABEL[u.role]}</Badge>
            </li>
          ))}
        </ul>
        {can(user.role, "manage_users") && (
          <form action={addStaffProfileAction} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
            <Input name="name" placeholder="Coach's name" required />
            <Input name="title" placeholder="Title (e.g. Pitching Coach)" />
            <Select name="role" defaultValue="assistant_coach">{(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select>
            <Button>Add to staff</Button>
          </form>
        )}
        {can(user.role, "manage_users") && (
          <details className="mt-4 text-sm">
            <summary className="text-slate-500 underline">Give someone their own personal login instead</summary>
            <form action={inviteUserAction} className="mt-3 grid gap-2 md:grid-cols-6">
              <Input name="name" placeholder="Name" required />
              <Input name="email" type="email" placeholder="Email" required />
              <Input name="title" placeholder="Title" />
              <Select name="role" defaultValue="assistant_coach">{(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select>
              <Input name="password" type="password" placeholder="Temporary password" minLength={8} required />
              <Button>Add</Button>
            </form>
          </details>
        )}
      </Card>

      {audit.length > 0 && (
        <Card title="Audit log">
          <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto text-xs">
            {audit.map((a) => <li key={a.id} className="flex gap-3 py-1"><span className="w-36 shrink-0 text-slate-500">{fmtDateTime(a.created_at)}</span><span className="w-32 shrink-0">{a.user_name ?? "RC (system)"}</span><span>{a.action.replace(/_/g, " ")} · {a.entity}</span></li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}
