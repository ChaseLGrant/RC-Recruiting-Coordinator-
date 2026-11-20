import Link from "next/link";
import { requireSession } from "@/lib/session";
import { listApprovals } from "@/lib/repo/approvals";
import { logoutAction } from "@/app/actions";
import { BottomTabs, NavLinks } from "@/components/nav";
import { ROLE_LABEL } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { ctx, user, org } = await requireSession();
  const pending = (await listApprovals(ctx.db, ctx.orgId, ["pending"])).length;
  const initials = user.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="min-h-screen pb-20 md:pb-0">
      {org.isDemo && (
        <div className="bg-violet-600 px-4 py-1.5 text-center text-xs font-medium text-white">
          Demo workspace. Every player, school and number here is fictional.
        </div>
      )}
      <header className="sticky top-0 z-30 bg-brand-900 text-white">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5" aria-label="RC home">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-[15px] font-bold tracking-tight text-brand-900">RC</span>
            <span className="hidden leading-tight sm:block">
              <span className="block text-[15px] font-semibold">Recruiting Coordinator</span>
              <span className="block text-[11px] text-blue-200/80">{org.name}</span>
            </span>
          </Link>
          <div className="flex-1" />
          <NavLinks pending={pending} />
          <details className="relative">
            <summary className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-sm font-semibold hover:bg-white/25" aria-label="Account menu">{initials}</summary>
            <div className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-2xl bg-white text-sm text-slate-800 shadow-xl ring-1 ring-slate-200">
              <div className="border-b border-slate-100 px-4 py-3">
                <div className="font-semibold">{user.name}</div>
                <div className="text-xs text-slate-500">{ROLE_LABEL[user.role]}</div>
              </div>
              <Link href="/missions" className="block px-4 py-2.5 hover:bg-slate-50">Saved searches</Link>
              <Link href="/approvals" className="block px-4 py-2.5 hover:bg-slate-50">Everything waiting on me</Link>
              <Link href="/impact" className="block px-4 py-2.5 hover:bg-slate-50">Time RC saved you</Link>
              <Link href="/settings" className="block px-4 py-2.5 hover:bg-slate-50">Settings & data</Link>
              <form action={logoutAction} className="border-t border-slate-100"><button className="w-full px-4 py-2.5 text-left text-slate-500 hover:bg-slate-50">Sign out</button></form>
            </div>
          </details>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      <BottomTabs pending={pending} />
    </div>
  );
}
