import Link from "next/link";
import { signupAction } from "@/app/actions";
import { AuthShell } from "@/components/auth-shell";
import { Button, Flash, Input, Label } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <AuthShell>
      <h1 className="font-display mb-4 text-4xl font-extrabold uppercase">Set up your staff</h1>
      <Flash error={error} />
      <form action={signupAction} className="space-y-3">
        <fieldset className="grid grid-cols-2 gap-2 text-sm">
          <label className="flex cursor-pointer items-start gap-2 rounded-[4px] border border-slate-300 p-2 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
            <input type="radio" name="mode" value="program" defaultChecked className="mt-1" />
            <span><b>My program</b><br /><span className="text-xs text-slate-600">Starts empty. Import authorized data.</span></span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 rounded-[4px] border border-slate-300 p-2 has-[:checked]:border-violet-600 has-[:checked]:bg-violet-50">
            <input type="radio" name="mode" value="demo" className="mt-1" />
            <span><b>Demo workspace</b><br /><span className="text-xs text-slate-600">Fictional athletes, clearly labeled.</span></span>
          </label>
        </fieldset>
        <div><Label>Program name</Label><Input name="programName" placeholder="State University Baseball" /></div>
        <div><Label>Campus location (ZIP or City, ST)</Label><Input name="campus" placeholder="78712" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Your name</Label><Input name="coachName" required /></div>
          <div><Label>Title</Label><Input name="coachTitle" placeholder="Recruiting Coordinator" /></div>
        </div>
        <div><Label>Email</Label><Input name="email" type="email" required /></div>
        <div><Label>Password (8+ characters)</Label><Input name="password" type="password" minLength={8} required /></div>
        <Button className="w-full">Create account</Button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-600">Already have an account? <Link className="text-brand-text underline" href="/login">Sign in</Link></p>
    </AuthShell>
  );
}
