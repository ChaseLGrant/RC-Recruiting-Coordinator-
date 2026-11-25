import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
import { getDb } from "@/lib/db";
import { currentSession } from "@/lib/session";
import { getOrg, listUsers } from "@/lib/repo";
import { logoutAction, pickStaffAction } from "@/app/actions";
import { Flash } from "@/components/ui";
import { brandingVars } from "@/lib/theme";

export const dynamic = "force-dynamic";

export default async function WhoPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const s = await currentSession();
  if (!s) redirect("/login");
  if (!s.login.isShared) redirect("/");
  const sp = await searchParams;
  const db = await getDb();
  const org = await getOrg(db, s.login.orgId);
  const staff = await listUsers(db, org.id);
  const b = org.settings.branding;
  const team = b.teamName ?? org.name;
  const vars = brandingVars(b) as CSSProperties;
  return (
    <div style={vars} className="team-scope grid min-h-screen place-items-center bg-[var(--team-ink)] px-4 py-10 text-white">
      <div className="w-full max-w-2xl">
        <div className="mb-8 flex items-center justify-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {b.logoDataUrl ? <img src={b.logoDataUrl} alt="" className="h-14 w-auto max-w-[7rem] object-contain" /> : <span className="font-display grid h-14 w-14 place-items-center bg-[var(--team-primary)] text-on-brand text-3xl font-extrabold">{team[0]}</span>}
          <span className="font-display text-3xl font-extrabold uppercase">{team}</span>
        </div>
        <h1 className="font-display text-center text-5xl font-extrabold uppercase sm:text-6xl">Who&apos;s using RC?</h1>
        <p className="mt-2 text-center text-sm text-white/60">Tap your name so your notes and contacts are credited to you.</p>
        <Flash error={sp.error} />
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {staff.map((u) => (
            <form key={u.id} action={pickStaffAction}>
              <input type="hidden" name="staffId" value={u.id} />
              <button className="group flex w-full flex-col items-center gap-3 border border-white/15 bg-white/5 px-3 py-5 transition hover:border-[var(--team-primary)] hover:bg-white/10">
                <span className="font-display grid h-16 w-16 place-items-center bg-[var(--team-primary)] text-on-brand text-3xl font-extrabold">{u.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}</span>
                <span className="text-center leading-tight">
                  <span className="block font-semibold">{u.name}</span>
                  <span className="mt-1 block text-xs text-white/60">{u.title ?? ""}</span>
                </span>
              </button>
            </form>
          ))}
        </div>
        {staff.length === 0 && <p className="mt-6 text-center text-sm text-white/70">No staff members yet. Ask your head coach to add the staff in Settings.</p>}
        <form action={logoutAction} className="mt-8 text-center"><button className="text-xs uppercase tracking-[0.14em] text-white/50 hover:text-white">Sign out</button></form>
      </div>
    </div>
  );
}
