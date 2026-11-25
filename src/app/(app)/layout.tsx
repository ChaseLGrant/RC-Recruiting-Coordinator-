import Link from "next/link";
import type { CSSProperties } from "react";
import { requireSession } from "@/lib/session";
import { listApprovals } from "@/lib/repo/approvals";
import { logoutAction, startFromPreviewAction, switchStaffAction } from "@/app/actions";
import { prospectForDemo, trackDemoView } from "@/lib/outreach/prospects";
import { BottomTabs, NavLinks } from "@/components/nav";
import { ROLE_LABEL } from "@/lib/domain/types";
import { isOwner } from "@/lib/billing/schools";
import { billingState } from "@/lib/billing/plan";
import { brandingVars } from "@/lib/theme";
import { BOOKING_URL } from "@/lib/site";
import { GUEST_DEMO_DAYS } from "@/lib/outreach/cleanup";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { ctx, user, org, shared } = await requireSession();
  const pending = (await listApprovals(ctx.db, ctx.orgId, ["pending"])).length;
  const billing = billingState(org);
  // School previews: count views (so RC knows who explored) and offer the real thing.
  const prospect = org.isDemo ? await prospectForDemo(ctx.db, org.id) : null;
  if (prospect) await trackDemoView(ctx.db, org.id);
  const isGuest = org.isDemo && user.email.endsWith("@guest.rc.local");
  const b = org.settings.branding;
  const team = b.teamName ?? org.name.replace(/\s*\(.*\)\s*$/, "");
  const initials = user.name.replace(/\(.*?\)/g, "").split(/\s+/).map((p) => p.replace(/[^\p{L}]/gu, "")[0] ?? "").join("").slice(0, 2).toUpperCase() || "RC";
  const vars = brandingVars(b) as CSSProperties;
  const expires = org.isDemo && org.createdAt
    ? new Date(Date.parse(org.createdAt) + GUEST_DEMO_DAYS() * 86_400_000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: org.settings.timezone || "UTC" })
    : null;
  return (
    <div style={vars} className="team-scope min-h-screen pb-20 md:pb-0">
      {org.isDemo && (
        <div className="bg-[#0a0b0d] text-white">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2 text-[12px] sm:px-6">
            <span className="flex items-center gap-2 font-semibold uppercase tracking-[0.14em] text-white/80">
              <span className="rounded-[2px] bg-[var(--team-mark)] px-1.5 py-0.5 text-[10px] font-extrabold text-[var(--team-on-mark)]">Demo</span>
              <span className="hidden sm:inline">Every player, school and number here is fictional</span><span className="sm:hidden">Fictional players</span>
            </span>
            {(prospect || isGuest) && expires && <span className="hidden text-white/45 lg:inline">Private to you · deletes itself {expires}</span>}
            <span className="flex-1" />
            {(prospect || isGuest) && (
              <span className="flex items-center gap-4">
                <a href={BOOKING_URL} target="_blank" rel="noopener noreferrer" className="hidden font-semibold text-white/70 underline decoration-white/25 underline-offset-4 hover:text-white sm:inline">Book a walkthrough</a>
                {prospect ? (
                  <form action={startFromPreviewAction}><button className="rounded-[3px] bg-white px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-[#0a0b0d] hover:bg-white/90">Set it up for real</button></form>
                ) : (
                  <form action={logoutAction}><input type="hidden" name="to" value="/signup" /><button className="rounded-[3px] bg-white px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-[#0a0b0d] hover:bg-white/90">Get RC for my program</button></form>
                )}
              </span>
            )}
          </div>
        </div>
      )}
      <header className="sticky top-0 z-30 border-b-4 border-[var(--team-primary-on-ink)] bg-[var(--team-ink)] pt-[env(safe-area-inset-top)] text-white">
        <div className="mx-auto flex h-[64px] max-w-6xl items-center gap-5 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:h-[72px] sm:px-6">
          <Link href="/" className="flex min-w-0 items-center gap-3" aria-label={`${team} home`}>
            {b.logoDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={b.logoDataUrl} alt={`${team} logo`} className="h-11 w-auto max-w-[5rem] object-contain" />
            ) : (
              <span className="font-display grid h-11 w-11 place-items-center bg-[var(--team-mark)] text-[var(--team-on-mark)] text-xl font-extrabold">{team.slice(0, 1)}</span>
            )}
            <span className="min-w-0 leading-none">
              <span className="font-display block truncate text-[19px] font-extrabold uppercase tracking-wide sm:text-[22px]">{team}</span>
              <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">Recruiting Coordinator</span>
            </span>
          </Link>
          <div className="flex-1" />
          <NavLinks pending={pending} />
          <Link href="/players/new" aria-label="Add a player" title="Add a player" className="grid h-9 w-9 place-items-center bg-[var(--team-mark)] text-[var(--team-on-mark)] text-xl font-bold leading-none hover:brightness-110">+</Link>
          <details className="relative">
            <summary className="grid h-9 w-9 place-items-center border border-white/25 text-xs font-bold tracking-wider hover:bg-white/10" aria-label="Account menu">{initials}</summary>
            <div className="absolute right-0 z-50 mt-2 w-64 border border-slate-200 bg-white text-sm text-slate-800 shadow-xl">
              <div className="border-b border-slate-100 px-4 py-3">
                <div className="font-semibold">{user.name}</div>
                <div className="text-xs text-slate-500">{user.title ?? ROLE_LABEL[user.role]}</div>
              </div>
              <Link href="/import" className="block px-4 py-2.5 hover:bg-slate-50">Import your list</Link>
              <Link href="/missions" className="block px-4 py-2.5 hover:bg-slate-50">Saved searches</Link>
              <Link href="/approvals" className="block px-4 py-2.5 hover:bg-slate-50">Everything waiting on me</Link>
              <Link href="/impact" className="block px-4 py-2.5 hover:bg-slate-50">Time RC saved you</Link>
              <Link href="/settings" className="block px-4 py-2.5 hover:bg-slate-50">Settings, staff & branding</Link>
              <Link href="/billing" className="block px-4 py-2.5 hover:bg-slate-50">Billing</Link>
              {isOwner(user.email) && <Link href="/admin" className="block px-4 py-2.5 font-semibold text-[var(--team-primary)] hover:bg-slate-50">RC owner page</Link>}
              {shared && <form action={switchStaffAction} className="border-t border-slate-100"><button className="w-full px-4 py-2.5 text-left hover:bg-slate-50">Switch coach</button></form>}
              <form action={logoutAction} className="border-t border-slate-100"><button className="w-full px-4 py-2.5 text-left text-slate-500 hover:bg-slate-50">Sign out</button></form>
            </div>
          </details>
        </div>
      </header>
      {billing.warning && <div className="bg-amber-50 px-4 py-2 text-center text-sm text-amber-950">{billing.warning} <Link href="/billing" className="font-semibold underline">Billing</Link></div>}
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">{children}</main>
      <footer className="mx-auto hidden max-w-6xl px-6 pb-10 text-[11px] uppercase tracking-[0.14em] text-slate-400 md:block">RC · Recruiting Coordinator · powered by The Athlete Market</footer>
      <BottomTabs pending={pending} />
    </div>
  );
}
