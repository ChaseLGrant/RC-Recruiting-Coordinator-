import Link from "next/link";
import { redirect } from "next/navigation";
import { tryDemoAction } from "@/app/actions";
import { currentUser } from "@/lib/session";
import { getDb } from "@/lib/db";
import { AuthShell } from "@/components/auth-shell";
import { SignInForm } from "@/components/site/sign-in-form";
import { SubmitButton } from "@/components/site/submit-button";
import { getOrgBySlug } from "@/lib/program-link";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; school?: string }> }) {
  if (await currentUser()) redirect("/");
  const { error, school } = await searchParams;
  // /login?school=<slug> is the same as the program's own page, /p/<slug>.
  if (school) {
    const org = await getOrgBySlug(await getDb(), school);
    if (org) redirect(`/p/${org.slug}${error ? `?error=${encodeURIComponent(error)}` : ""}`);
  }
  return (
    <AuthShell>
      <p className="eyebrow text-[var(--site-brass)]">Staff sign-in</p>
      <h1 className="font-display mt-3 text-5xl font-extrabold uppercase leading-none">Welcome back, Coach.</h1>
      <p className="mb-7 mt-3 text-[15px] text-[var(--site-muted)]">Your board has been working while you were away.</p>
      <SignInForm error={error} />
      <div className="my-8 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--site-dim)]"><span className="h-px flex-1 bg-[var(--site-line)]" />New to RC<span className="h-px flex-1 bg-[var(--site-line)]" /></div>
      <div className="grid gap-3">
        <Link href="/demo" className="btn-line w-full">See RC in your colors</Link>
        <form action={tryDemoAction}>
          <SubmitButton pending="Opening the demo…" className="w-full py-2 text-[13px] font-semibold text-[var(--site-muted)] underline decoration-white/20 underline-offset-4 hover:text-white">Or open a sample program instantly</SubmitButton>
        </form>
      </div>
      <p className="mt-8 text-center text-sm text-[var(--site-muted)]">Setting up your program? <Link className="font-semibold text-[var(--site-text)] underline decoration-white/30 underline-offset-4" href="/signup">Create your account</Link></p>
    </AuthShell>
  );
}
