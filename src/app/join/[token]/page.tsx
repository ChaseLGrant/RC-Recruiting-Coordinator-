import type { CSSProperties } from "react";
import { getDb } from "@/lib/db";
import { inviteInfo } from "@/lib/billing/schools";
import { TRIAL_DAYS, billingEnforced } from "@/lib/billing/plan";
import { acceptInviteAction } from "@/app/actions";
import { Button, Flash, Input, Label } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function JoinPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const info = await inviteInfo(await getDb(), token);
  if (!info.ok) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#0f1722] px-4 text-center text-white">
        <div>
          <h1 className="font-display text-4xl font-extrabold uppercase">Invite link</h1>
          <p className="mt-3 text-white/70">{info.reason}</p>
          <a href="/login" className="mt-6 inline-block border border-white/30 px-5 py-2.5 text-sm font-semibold uppercase tracking-wider hover:bg-white/10">Sign in</a>
        </div>
      </div>
    );
  }
  const org = info.org;
  const b = org.settings.branding;
  const team = b.teamName ?? org.name;
  const vars = { "--team-primary": b.primary, "--team-ink": b.ink, "--team-accent": b.accent } as CSSProperties;
  return (
    <div style={vars} className="team-scope min-h-screen bg-[var(--color-canvas)]">
      <header className="bg-[var(--team-ink)] px-4 pb-10 pt-[calc(env(safe-area-inset-top)+2.5rem)] text-white">
        <div className="mx-auto flex max-w-2xl items-center gap-4">
          {b.logoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={b.logoDataUrl} alt={`${team} logo`} className="h-16 w-16 object-contain" />
          ) : (
            <span className="font-display grid h-16 w-16 place-items-center bg-[var(--team-primary)] text-4xl font-extrabold">{team[0]}</span>
          )}
          <div>
            <p className="eyebrow text-white/60">Recruiting Coordinator</p>
            <h1 className="font-display text-4xl font-extrabold uppercase leading-none sm:text-5xl">Welcome, {team}</h1>
          </div>
        </div>
        <p className="mx-auto mt-4 max-w-2xl text-[15px] text-white/75">
          RC is ready for your program. Set up your account and your staff below. {billingEnforced() ? `Then start your ${TRIAL_DAYS()}-day free trial.` : ""}
        </p>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-8">
        <Flash error={sp.error} />
        <form action={acceptInviteAction} className="space-y-6 border border-slate-900/10 border-t-4 border-t-[var(--team-primary)] bg-white p-5 sm:p-6">
          <input type="hidden" name="token" value={token} />
          <section>
            <h2 className="font-display text-2xl font-extrabold uppercase">Your account</h2>
            <p className="mb-3 text-sm text-slate-500">This is the head coach&apos;s own login. It manages billing and settings.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>Your name</Label><Input name="name" required autoComplete="name" /></div>
              <div><Label>Title</Label><Input name="title" placeholder="Head Coach" /></div>
              <div><Label>Email</Label><Input name="email" type="email" required autoComplete="email" /></div>
              <div><Label>Password (8+ characters)</Label><Input name="password" type="password" minLength={8} required autoComplete="new-password" /></div>
            </div>
          </section>
          <section>
            <h2 className="font-display text-2xl font-extrabold uppercase">Your staff</h2>
            <p className="mb-3 text-sm text-slate-500">One name per line, with a title if you like. They&apos;ll sign in with a shared staff login and tap their name.</p>
            <textarea name="staff" rows={4} className="w-full rounded-[3px] border border-slate-200 px-3 py-2 text-sm" placeholder={"Hayden Carter, Pitching Coach\nChase Grant, Outfield Coach"} />
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div><Label>Staff login email</Label><Input name="staffEmail" type="email" placeholder="baseballstaff@yourschool.edu" /></div>
              <div><Label>Staff login password (different from yours)</Label><Input name="staffPassword" type="password" minLength={8} autoComplete="new-password" /></div>
            </div>
          </section>
          <Button className="w-full sm:w-auto">{billingEnforced() ? "Create accounts & continue" : "Create accounts"}</Button>
          <p className="text-xs text-slate-500">By continuing you agree to RC&apos;s terms and privacy policy.</p>
        </form>
      </main>
    </div>
  );
}
