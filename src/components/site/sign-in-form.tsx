import { loginAction } from "@/app/actions";
import { SubmitButton } from "./submit-button";

export function SignInForm({ from, error, branded = false }: { from?: string; error?: string; branded?: boolean }) {
  return (
    <form action={loginAction} className="space-y-4">
      {from && <input type="hidden" name="from" value={from} />}
      {error && <p role="alert" className="border-l-2 border-rose-400 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</p>}
      <div>
        <label htmlFor="email" className="site-label">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email" className="site-field" />
      </div>
      <div>
        <label htmlFor="password" className="site-label">Password</label>
        <input id="password" name="password" type="password" required autoComplete="current-password" className="site-field" />
      </div>
      <SubmitButton pending="Signing in…" className={`${branded ? "btn-team" : "btn-solid"} w-full`}>Sign in</SubmitButton>
    </form>
  );
}
