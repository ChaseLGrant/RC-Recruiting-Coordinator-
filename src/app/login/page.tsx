import Link from "next/link";
import { redirect } from "next/navigation";
import { loginAction, tryDemoAction } from "@/app/actions";
import { currentUser } from "@/lib/session";
import { Button, Flash, Input, Label } from "@/components/ui";
import { AuthShell } from "@/components/auth-shell";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await currentUser()) redirect("/");
  const { error } = await searchParams;
  return (
    <AuthShell>
      <h1 className="font-display text-4xl font-extrabold uppercase">Sign in</h1>
      <p className="mb-4 text-sm text-slate-600">Your recruiting staff has been working.</p>
      <Flash error={error} />
      <form action={loginAction} className="space-y-3">
        <div><Label>Email</Label><Input name="email" type="email" required autoComplete="email" /></div>
        <div><Label>Password</Label><Input name="password" type="password" required autoComplete="current-password" /></div>
        <Button className="w-full">Sign in</Button>
      </form>
      <div className="my-5 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400"><span className="h-px flex-1 bg-slate-200" />or<span className="h-px flex-1 bg-slate-200" /></div>
      <form action={tryDemoAction}>
        <button className="w-full rounded-[3px] border-2 border-slate-900 px-4 py-3 text-[13px] font-bold uppercase tracking-[0.06em] text-slate-900 hover:bg-slate-900 hover:text-white">Try RC now · no sign-up</button>
        <p className="mt-2 text-center text-xs text-slate-500">Opens your own demo board with sample players. Nothing to fill in.</p>
      </form>
      <p className="mt-4 text-center text-sm text-slate-600">New program? <Link className="text-brand-text underline" href="/signup">Create an account</Link></p>
    </AuthShell>
  );
}

