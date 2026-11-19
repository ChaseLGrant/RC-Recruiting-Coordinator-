import Link from "next/link";
import { requireSession } from "@/lib/session";
import { listApprovals } from "@/lib/repo/approvals";
import { logoutAction } from "@/app/actions";
import { NavLinks } from "@/components/nav";
import { ROLE_LABEL } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { ctx, user, org } = await requireSession();
  const pending = (await listApprovals(ctx.db, ctx.orgId, ["pending"])).length;
  return (
    <div className="min-h-screen">
      {org.isDemo && (
        <div className="bg-violet-700 px-4 py-1.5 text-center text-xs font-medium text-white">
          DEMONSTRATION WORKSPACE — every athlete, school, schedule and measurement here is fictional. Real programs start empty and use only authorized data.
        </div>
      )}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-900 text-sm font-bold text-white">RC</span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold text-slate-900">Recruiting Coordinator</span>
              <span className="block text-[11px] text-slate-500">powered by The Athlete Market</span>
            </span>
          </Link>
          <NavLinks pending={pending} />
          <div className="ml-auto flex items-center gap-3 text-xs text-slate-600">
            <span className="hidden text-right sm:block">
              <span className="block font-medium text-slate-800">{user.name}</span>
              <span className="block">{org.name} · {ROLE_LABEL[user.role]}</span>
            </span>
            <form action={logoutAction}>
              <button className="rounded-lg px-2 py-1 hover:bg-slate-100">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-slate-400">
        Your standards. Your evaluations. Your recruiting decisions. RC does the legwork. RC never assigns talent grades, never contacts recruits without your approval, and shows the source of every number.
      </footer>
    </div>
  );
}
