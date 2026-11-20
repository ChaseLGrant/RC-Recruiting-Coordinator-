import Link from "next/link";
import { redirect } from "next/navigation";
import { loginAction } from "@/app/actions";
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
      <p className="mt-4 text-center text-sm text-slate-600">New program? <Link className="text-brand-600 underline" href="/signup">Create an account</Link></p>
    </AuthShell>
  );
}

