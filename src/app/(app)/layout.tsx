import Link from "next/link";
import type { CSSProperties } from "react";
import { requireSession } from "@/lib/session";
import { listApprovals } from "@/lib/repo/approvals";
import { logoutAction } from "@/app/actions";
import { BottomTabs, NavLinks } from "@/components/nav";
import { ROLE_LABEL } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { ctx, user, org } = await requireSession();
  const pending = (await listApprovals(ctx.db, ctx.orgId, ["pending"])).length;
  const b = org.settings.branding;
  const team = b.teamName ?? org.name.replace(/\s*\(.*\)\s*$/, "");
  const initials = user.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const vars = { "--team-primary": b.primary, "--team-ink": b.ink, "--team-accent": b.accent } as CSSProperties;
  return (
    <div style={vars} className="team-scope min-h-screen pb-20 md:pb-0">
      {org.isDemo && (
        <div className="bg-[var(--team-accent)] px-4 py-1 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--team-ink)]">
          Demo · every player, school and number shown is fictional
        </div>
      )}
      <header className="sticky top-0 z-30 border-b-4 border-[var(--team-primary)] bg-[var(--team-ink)] text-white">
        <div className="mx-auto flex h-[72px] max-w-6xl items-center gap-5 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-3" aria-label={`${team} home`}>
            {b.logoDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={b.logoDataUrl} alt={`${team} logo`} className="h-11 w-11 object-contain" />
            ) : (
              <span className="font-display grid h-11 w-11 place-items-center bg-[var(--team-primary)] text-xl font-extrabold">{team.slice(0, 1)}</span>
            )}
            <span className="leading-none">
              <span className="font-display block text-[22px] font-extrabold uppercase tracking-wide">{team}</span>
              <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">Recruiting Coordinator</span>
            </span>
          </Link>
          <div className="flex-1" />
          <NavLinks pending={pending} />
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
              <form action={logoutAction} className="border-t border-slate-100"><button className="w-full px-4 py-2.5 text-left text-slate-500 hover:bg-slate-50">Sign out</button></form>
            </div>
          </details>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">{children}</main>
      <footer className="mx-auto hidden max-w-6xl px-6 pb-10 text-[11px] uppercase tracking-[0.14em] text-slate-400 md:block">RC · Recruiting Coordinator · powered by The Athlete Market</footer>
      <BottomTabs pending={pending} />
    </div>
  );
}
