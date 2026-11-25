/* eslint-disable @next/next/no-img-element */
import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteNav } from "@/components/site/chrome";
import { BOOKING_URL, PRICING_MAILTO } from "@/lib/site";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "RC — Your recruiting staff that never sleeps",
  description: "RC finds players who fit your standards, keeps their stats and schedules current, and drafts the outreach. Every number sourced. Nothing sent without a coach.",
};

const PRINCIPLES: Array<[string, string]> = [
  ["Your standards", "No talent scores. RC shows how each player measures against the bar your staff set."],
  ["Every number sourced", "Source, date measured, date checked, and who verified it. One tap away."],
  ["Compliance checked twice", "When a draft is approved and again when it's sent. Opt-outs always win."],
  ["Nothing sent without you", "RC prepares. A coach approves. Every action lands in the audit log."],
];

const STEPS: Array<[string, string, string]> = [
  ["01", "Set the bar", "Grad years, positions, miles from campus, any measurable. Mark each one required, preferred or optional, and choose whether it has to be verified."],
  ["02", "RC works the board", "Saved searches run on schedule. Linked stat pages are re-checked, game schedules watched, camp invite lists built, duplicates flagged."],
  ["03", "You make the calls", "Each morning: new players who fit, numbers that moved, games this week, and drafts waiting on your OK. Approve, edit or pass."],
];

export default async function Landing() {
  const signedIn = Boolean(await currentUser().catch(() => null));
  return (
    <div className="site min-h-screen overflow-x-clip">
      <SiteNav signedIn={signedIn} />

      {/* Hero */}
      <section className="relative">
        <div aria-hidden className="hairline-grid pointer-events-none absolute inset-0 opacity-60 [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
        <div className="relative mx-auto max-w-7xl px-5 pb-16 pt-14 sm:px-8 sm:pb-24 sm:pt-24">
          <p className="rise eyebrow text-[var(--site-brass)]">Recruiting Coordinator · for college baseball staffs</p>
          <h1 className="rise rise-1 font-display mt-5 max-w-5xl text-[3.4rem] font-extrabold uppercase leading-[0.86] tracking-[-0.005em] sm:text-[6.5rem] lg:text-[8rem]">
            Your recruiting staff that never sleeps.
          </h1>
          <div className="rise rise-2 mt-8 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
            <p className="max-w-2xl text-[17px] leading-relaxed text-[var(--site-muted)] sm:text-[19px]">
              RC finds the players who fit your standards, keeps their stats and schedules current, and drafts the outreach.
              <span className="text-[var(--site-text)]"> Every number shows where it came from. Nothing reaches a recruit without a coach&apos;s OK.</span>
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href="/demo" className="btn-solid">See RC in your colors</Link>
              <a href={BOOKING_URL} target="_blank" rel="noopener noreferrer" className="btn-line">Book a demo</a>
            </div>
          </div>
          <p className="rise rise-3 mt-4 text-[13px] text-[var(--site-dim)] lg:text-right">Your school&apos;s colors and logo, sample players near your campus. About 30 seconds, no sign-up.</p>

          {/* Product, not stock art */}
          <div className="rise rise-4 relative mt-14 sm:mt-20">
            <div className="frame">
              <div className="frame-bar"><i /><i /><i /><span className="ml-3 truncate text-[11px] text-[var(--site-dim)]">Home · Daily brief</span></div>
              <img src="/product/dashboard.webp" alt="RC home screen: search, new players, approvals waiting, games this week" width={1440} height={900} className="block h-auto w-full" />
            </div>
            <div className="frame absolute -bottom-10 right-3 hidden w-[24%] max-w-[260px] rounded-[18px] md:block">
              <img src="/product/mobile-board.webp" alt="RC on a phone: the staff's player board" width={390} height={844} className="block h-auto w-full" />
            </div>
          </div>
        </div>
      </section>

      {/* Principles */}
      <section className="border-y border-[var(--site-line)] bg-[var(--site-panel)]">
        <div className="mx-auto grid max-w-7xl divide-y divide-[var(--site-line)] px-5 sm:grid-cols-2 sm:px-8 lg:grid-cols-4 lg:divide-x lg:divide-y-0">
          {PRINCIPLES.map(([h, t]) => (
            <div key={h} className="py-7 sm:px-6 lg:first:pl-0">
              <h2 className="font-display text-2xl font-extrabold uppercase leading-none">{h}</h2>
              <p className="mt-2.5 text-sm leading-relaxed text-[var(--site-muted)]">{t}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-7xl scroll-mt-20 px-5 py-20 sm:px-8 sm:py-28">
        <SectionHead eyebrow="How the staff works" title="You set the standard. RC does the legwork." />
        <ol className="mt-12 grid gap-px overflow-hidden border border-[var(--site-line)] bg-[var(--site-line)] md:grid-cols-3">
          {STEPS.map(([n, h, t]) => (
            <li key={n} className="bg-[var(--site-bg)] p-7 sm:p-8">
              <span className="font-display text-5xl font-extrabold text-[var(--site-brass)]">{n}</span>
              <h3 className="font-display mt-6 text-3xl font-extrabold uppercase leading-none">{h}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-[var(--site-muted)]">{t}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Evidence */}
      <Feature
        id="evidence"
        eyebrow="Evidence Mode"
        title="Trust the number, or see exactly why not."
        body="Tap any measurable to see every observation behind it: the source, when it was measured, when RC last checked it, and who verified it. When two sources disagree, you see both side by side. The verified mark only appears when the number has earned it."
        bullets={["Exit velo, 60 time, height, weight, any metric you track", "Stale numbers are labeled, not hidden", "Your own imports are tagged “per your import”, never passed off as verified"]}
        img={{ src: "/product/athlete.webp", alt: "A player's profile in RC with sourced, dated measurables", w: 1440, h: 900 }}
      />

      {/* Compliance */}
      <Feature
        id="compliance"
        flip
        eyebrow="Approvals & compliance"
        title="Nothing leaves the building without a coach."
        body="RC prepares new prospects, camp invite lists, outreach drafts and itineraries, then waits. Your compliance office sets contact dates by class, the recruiting calendar and guardian-consent rules. When RC isn't sure, the draft goes to compliance review instead of out the door."
        bullets={["Checked when approved and again when sent", "Opted-out athletes are blocked, every time", "Roles for head coach, assistants, compliance and viewers, with an audit log"]}
        img={{ src: "/product/approvals.webp", alt: "RC's approval queue with outreach drafts waiting on a coach", w: 1440, h: 900 }}
      />

      {/* Time */}
      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24">
        <div className="grid gap-10 border-t border-[var(--site-line)] pt-12 md:grid-cols-3">
          <Stat k="Overnight" v="Saved searches, stat re-checks and schedule changes run while your staff sleeps or travels." />
          <Stat k="One login" v="The whole staff on one board, from a phone in the stands or a laptop in the office." />
          <Stat k="Measured" v="RC counts every task it did. Time saved is shown as an estimate, with minutes you can adjust." />
        </div>
      </section>

      {/* Your colors */}
      <section id="colors" className="scroll-mt-20 border-y border-[var(--site-line)] bg-[var(--site-panel)]">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
          <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
            <SectionHead eyebrow="Your program, your colors" title="It looks like your program because it is." />
            <Link href="/demo" className="btn-solid self-start lg:self-end">Build my demo</Link>
          </div>
          <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-[var(--site-muted)]">Your logo and colors across every screen, with readable contrast picked automatically. Your staff signs in at your program&apos;s own page.</p>
          <div className="mt-12 grid gap-6 md:grid-cols-2">
            <figure>
              <div className="frame"><img src="/product/brand-green.webp" alt="RC in green and gold for a sample program: the staff board" width={1440} height={900} className="block h-auto w-full" /></div>
              <figcaption className="mt-3 text-[12px] uppercase tracking-[0.14em] text-[var(--site-dim)]">Green &amp; gold · sample program</figcaption>
            </figure>
            <figure>
              <div className="frame"><img src="/product/brand-red.webp" alt="RC in red and black for a sample program: the home screen" width={1440} height={900} className="block h-auto w-full" /></div>
              <figcaption className="mt-3 text-[12px] uppercase tracking-[0.14em] text-[var(--site-dim)]">Red &amp; black · sample program</figcaption>
            </figure>
          </div>
        </div>
      </section>

      {/* Security */}
      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
        <SectionHead eyebrow="Built for athletic departments" title="Your board stays yours." />
        <div className="mt-12 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["Walled off by program", "Every record is scoped to your program and tested for isolation. Another school never sees your board."],
            ["Locked down accounts", "Hashed passwords and sessions, lockout after repeated failed sign-ins, strict security headers."],
            ["Minors' privacy", "Opt-outs are permanent. An admin can delete a player's records completely, with the reason logged."],
            ["No scraping behind logins", "RC reads public pages your staff links, identifies itself, and respects each site's rules."],
            ["Export any time", "Download your whole board, notes, contacts and sources as a spreadsheet. No lock-in."],
            ["A full audit trail", "Every approval, edit, message and setting change is recorded with who and when."],
          ].map(([h, t]) => (
            <div key={h} className="border-t border-[var(--site-line)] pt-5">
              <h3 className="text-[15px] font-bold text-[var(--site-text)]">{h}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--site-muted)]">{t}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-20 border-t border-[var(--site-line)]">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <p className="eyebrow text-[var(--site-brass)]">Pricing</p>
            <h2 className="font-display mt-4 text-5xl font-extrabold uppercase leading-[0.9] sm:text-7xl">One program.<br />One license.<br />Whole staff.</h2>
          </div>
          <div className="site-panel self-end p-7 sm:p-9">
            <p className="text-[17px] leading-relaxed text-[var(--site-text)]">RC is licensed per program, sized to your staff and how you recruit. Every license includes the full staff, compliance roles, branding and your own sign-in page.</p>
            <ul className="mt-6 space-y-2.5 text-sm text-[var(--site-muted)]">
              <li className="flex gap-3"><Tick />Free trial for your program. No card to start.</li>
              <li className="flex gap-3"><Tick />Your board, notes and contacts are always yours.</li>
              <li className="flex gap-3"><Tick />Annual or monthly, invoice or card.</li>
            </ul>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href={PRICING_MAILTO} className="btn-solid">Request pricing</a>
              <a href={BOOKING_URL} target="_blank" rel="noopener noreferrer" className="btn-line">Book a 30-min demo</a>
            </div>
          </div>
        </div>
      </section>

      {/* Closing */}
      <section className="border-t border-[var(--site-line)] bg-[var(--site-panel)]">
        <div className="mx-auto flex max-w-7xl flex-col items-start gap-8 px-5 py-16 sm:px-8 md:flex-row md:items-center md:justify-between">
          <h2 className="font-display text-4xl font-extrabold uppercase leading-[0.92] sm:text-5xl">See your program on RC<br className="hidden sm:block" /> before your next practice.</h2>
          <Link href="/demo" className="btn-solid shrink-0">See it in your colors</Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

function SectionHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <p className="eyebrow text-[var(--site-brass)]">{eyebrow}</p>
      <h2 className="font-display mt-4 max-w-4xl text-[2.6rem] font-extrabold uppercase leading-[0.9] sm:text-6xl">{title}</h2>
    </div>
  );
}

function Feature({ id, eyebrow, title, body, bullets, img, flip }: { id: string; eyebrow: string; title: string; body: string; bullets: string[]; img: { src: string; alt: string; w: number; h: number }; flip?: boolean }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-[var(--site-line)]">
      <div className={`mx-auto grid max-w-7xl items-center gap-12 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[0.9fr_1.1fr] ${flip ? "lg:[&>*:first-child]:order-2" : ""}`}>
        <div>
          <p className="eyebrow text-[var(--site-brass)]">{eyebrow}</p>
          <h2 className="font-display mt-4 text-[2.6rem] font-extrabold uppercase leading-[0.9] sm:text-6xl">{title}</h2>
          <p className="mt-6 text-[16px] leading-relaxed text-[var(--site-muted)]">{body}</p>
          <ul className="mt-6 space-y-2.5 text-sm text-[var(--site-text)]">
            {bullets.map((b) => <li key={b} className="flex gap-3"><Tick />{b}</li>)}
          </ul>
        </div>
        <div className="frame">
          <div className="frame-bar"><i /><i /><i /></div>
          <img src={img.src} alt={img.alt} width={img.w} height={img.h} loading="lazy" className="block h-auto w-full" />
        </div>
      </div>
    </section>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="font-display text-5xl font-extrabold uppercase leading-none text-[var(--site-text)]">{k}</p>
      <p className="mt-3 max-w-xs text-[15px] leading-relaxed text-[var(--site-muted)]">{v}</p>
    </div>
  );
}

function Tick() {
  return <svg viewBox="0 0 16 16" aria-hidden className="mt-[3px] h-4 w-4 shrink-0 text-[var(--site-brass)]" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 8.5l3.2 3L13 4.5" /></svg>;
}
