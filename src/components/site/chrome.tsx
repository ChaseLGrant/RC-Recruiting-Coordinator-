import Link from "next/link";
import { Wordmark } from "./brand";
import { BOOKING_URL, PRICING_MAILTO, SALES_EMAIL } from "@/lib/site";

export function SiteNav({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--site-line)] bg-[#0a0b0d]/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-5 sm:px-8">
        <Wordmark />
        <nav className="ml-6 hidden items-center gap-7 text-[13px] text-[var(--site-muted)] lg:flex" aria-label="Site">
          <a href="/#how" className="hover:text-white">How it works</a>
          <a href="/#evidence" className="hover:text-white">Evidence</a>
          <a href="/#compliance" className="hover:text-white">Compliance</a>
          <a href="/#colors" className="hover:text-white">Your colors</a>
          <a href="/#pricing" className="hover:text-white">Pricing</a>
        </nav>
        <div className="flex-1" />
        <Link href={signedIn ? "/" : "/login"} className="hidden text-[13px] font-semibold text-[var(--site-muted)] hover:text-white sm:block">{signedIn ? "Open RC" : "Sign in"}</Link>
        <Link href="/demo" className="btn-solid !min-h-10 !px-4 !py-2 !text-[12px]">See it in your colors</Link>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--site-line)]">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Wordmark />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-[var(--site-muted)]">A recruiting staff that works your board around the clock and leaves every decision to you.</p>
          <p className="mt-6 text-[11px] uppercase tracking-[0.18em] text-[var(--site-dim)]">Powered by The Athlete Market</p>
        </div>
        <div className="text-sm">
          <p className="site-label">Product</p>
          <ul className="space-y-2 text-[var(--site-muted)]">
            <li><Link href="/demo" className="hover:text-white">See it in your colors</Link></li>
            <li><Link href="/login" className="hover:text-white">Staff sign-in</Link></li>
            <li><Link href="/signup" className="hover:text-white">Set up your program</Link></li>
          </ul>
        </div>
        <div className="text-sm">
          <p className="site-label">Talk to us</p>
          <ul className="space-y-2 text-[var(--site-muted)]">
            <li><a href={BOOKING_URL} target="_blank" rel="noopener noreferrer" className="hover:text-white">Book a 30-minute demo</a></li>
            <li><a href={PRICING_MAILTO} className="hover:text-white">Request pricing</a></li>
            <li><a href={`mailto:${SALES_EMAIL}`} className="hover:text-white">{SALES_EMAIL}</a></li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
