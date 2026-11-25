/* eslint-disable @next/next/no-img-element */
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/site/brand";

export interface ProgramLook { team: string; logo: string | null; vars: CSSProperties }

/** Sign-in / sign-up frame. Plain RC, or wearing a program's colors and logo on its own sign-in page. */
export function AuthShell({ children, program, aside }: { children: ReactNode; program?: ProgramLook | null; aside?: ReactNode }) {
  if (program) {
    return (
      <div style={program.vars} className="site team-scope relative grid min-h-screen place-items-center overflow-hidden bg-[var(--team-ink)] px-5 py-12">
        <div aria-hidden className="absolute inset-x-0 top-0 h-1.5 bg-[var(--team-primary-on-ink)]" />
        <div className="relative w-full max-w-[420px]">
          <div className="rise flex flex-col items-center text-center">
            {program.logo ? (
              <img src={program.logo} alt={`${program.team} logo`} className="h-20 w-auto max-w-[11rem] object-contain" />
            ) : (
              <span className="font-display grid h-20 w-20 place-items-center bg-[var(--team-mark)] text-5xl font-extrabold text-[var(--team-on-mark)]">{program.team.slice(0, 1)}</span>
            )}
            <p className="font-display mt-5 text-4xl font-extrabold uppercase leading-none text-white">{program.team}</p>
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-accent-on-ink">Recruiting Coordinator · Staff sign-in</p>
          </div>
          <div className="rise rise-1 mt-9 rounded-[4px] border border-white/10 bg-black/25 p-6 backdrop-blur sm:p-7">{children}</div>
          <p className="mt-8 text-center text-[11px] uppercase tracking-[0.18em] text-white/35">Powered by RC · The Athlete Market</p>
        </div>
      </div>
    );
  }
  return (
    <div className="site grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-[var(--site-line)] p-12 lg:flex">
        <div aria-hidden className="hairline-grid pointer-events-none absolute inset-0 opacity-70" />
        <div className="relative"><Wordmark /></div>
        <div className="relative">
          {aside ?? (
            <>
              <h1 className="font-display text-[5.5rem] font-extrabold uppercase leading-[0.86]">Your standards.<br />Your decisions.<br /><span className="text-[var(--site-brass)]">Our legwork.</span></h1>
              <p className="mt-6 max-w-md text-[15px] leading-relaxed text-[var(--site-muted)]">RC finds the players who fit your program, shows where every number came from, and never contacts a recruit without your OK.</p>
              <EvidenceCard />
            </>
          )}
        </div>
        <p className="relative text-[11px] uppercase tracking-[0.18em] text-[var(--site-dim)]">Powered by The Athlete Market</p>
      </div>
      <div className="flex min-h-screen flex-col px-5 py-8 sm:px-10">
        <div className="flex items-center justify-between lg:justify-end">
          <span className="lg:hidden"><Wordmark /></span>
          <Link href="/" className="text-[13px] text-[var(--site-muted)] hover:text-white">← rc home</Link>
        </div>
        <div className="grid flex-1 place-items-center py-10">
          <div className="rise w-full max-w-[420px]">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** A small, honest illustration of Evidence Mode (fictional player). */
function EvidenceCard() {
  const rows: Array<[string, string, string, boolean]> = [
    ["Exit velo", "91 mph", "Fall showcase · Oct 12", true],
    ["60 yd", "6.84 s", "Camp timing · Sep 28", true],
    ["Height", "6'1\"", "Per your import", false],
  ];
  return (
    <div className="site-panel mt-10 max-w-md rounded-[4px] p-5">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold">Marcus Reyes <span className="ml-1 rounded-[2px] bg-white/10 px-1 text-[9px] font-bold text-[var(--site-muted)]">DEMO</span></p>
        <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--site-dim)]">SS · 2027</p>
      </div>
      <p className="mt-1 text-[12px] text-[var(--site-muted)]">Meets 5 of your 6 standards</p>
      <ul className="mt-4 divide-y divide-[var(--site-line)] border-t border-[var(--site-line)] text-[13px]">
        {rows.map(([k, v, s, ok]) => (
          <li key={k} className="flex items-center justify-between gap-3 py-2.5">
            <span className="text-[var(--site-muted)]">{k}</span>
            <span className="flex items-center gap-3">
              <span className="text-[11px] text-[var(--site-dim)]">{s}</span>
              <span className="font-display text-lg font-bold tabular-nums">{v}</span>
              <span className={`text-[10px] font-bold uppercase tracking-[0.1em] ${ok ? "text-emerald-300" : "text-[var(--site-dim)]"}`}>{ok ? "Verified" : "Unverified"}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
