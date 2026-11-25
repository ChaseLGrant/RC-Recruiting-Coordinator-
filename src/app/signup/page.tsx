import Link from "next/link";
import { signupAction } from "@/app/actions";
import { AuthShell } from "@/components/auth-shell";
import { SubmitButton } from "@/components/site/submit-button";

export const dynamic = "force-dynamic";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <AuthShell
      aside={
        <>
          <h1 className="font-display text-[5rem] font-extrabold uppercase leading-[0.86]">Set up<br />your staff.</h1>
          <ul className="mt-8 max-w-md space-y-4 text-[15px] leading-relaxed text-[var(--site-muted)]">
            <li><b className="text-[var(--site-text)]">Starts empty, stays honest.</b> Your program only holds data you bring in or are licensed to use.</li>
            <li><b className="text-[var(--site-text)]">Bring your list in minutes.</b> Spreadsheet, Google Sheet, or a photo of the one on your clipboard.</li>
            <li><b className="text-[var(--site-text)]">Your colors from day one.</b> Logo, colors and your own staff sign-in page.</li>
          </ul>
        </>
      }
    >
      <p className="eyebrow text-[var(--site-brass)]">New program</p>
      <h1 className="font-display mt-3 text-5xl font-extrabold uppercase leading-none">Create your account</h1>
      <p className="mb-7 mt-3 text-[15px] text-[var(--site-muted)]">Just looking? <Link href="/demo" className="font-semibold text-[var(--site-text)] underline decoration-white/30 underline-offset-4">See a demo in your colors</Link> first. No sign-up.</p>
      {error && <p role="alert" className="mb-4 border-l-2 border-rose-400 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</p>}
      <form action={signupAction} className="space-y-4">
        <input type="hidden" name="mode" value="program" />
        <div><label htmlFor="programName" className="site-label">Program</label><input id="programName" name="programName" required placeholder="State University Baseball" className="site-field" /></div>
        <div><label htmlFor="campus" className="site-label">Campus ZIP or City, ST</label><input id="campus" name="campus" placeholder="78712" className="site-field" /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label htmlFor="coachName" className="site-label">Your name</label><input id="coachName" name="coachName" required autoComplete="name" className="site-field" /></div>
          <div><label htmlFor="coachTitle" className="site-label">Title</label><input id="coachTitle" name="coachTitle" placeholder="Head Coach" className="site-field" /></div>
        </div>
        <div><label htmlFor="email" className="site-label">Work email</label><input id="email" name="email" type="email" required autoComplete="email" className="site-field" /></div>
        <div><label htmlFor="password" className="site-label">Password · 8+ characters</label><input id="password" name="password" type="password" minLength={8} required autoComplete="new-password" className="site-field" /></div>
        <SubmitButton pending="Setting up your program…" className="btn-solid w-full">Create account</SubmitButton>
      </form>
      <p className="mt-6 text-center text-sm text-[var(--site-muted)]">Already on RC? <Link className="font-semibold text-[var(--site-text)] underline decoration-white/30 underline-offset-4" href="/login">Sign in</Link></p>
    </AuthShell>
  );
}
