import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getProspectBySlug, recordVisit } from "@/lib/outreach/prospects";
import { openPreviewAction } from "@/app/actions";
import { Flash } from "@/components/ui";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = await getProspectBySlug(await getDb(), (await params).slug);
  const team = p ? (p.teamName ?? p.branding.teamName ?? p.programName) : "RC";
  return { title: `${team} · Recruiting Coordinator`, description: `A recruiting assistant set up for ${team}. Tap to try it. No sign-up.`, robots: { index: false, follow: false } };
}

// The page a coach lands on from the email. Personal, branded, one button.
export default async function PreviewLanding({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const db = await getDb();
  const p = await getProspectBySlug(db, slug);
  if (!p) notFound();
  await recordVisit(db, p.id);
  const b = p.branding;
  const team = p.teamName ?? b.teamName ?? p.programName;
  const first = (p.coachName ?? "").replace(/^(coach|dr\.?|mr\.?)\s+/i, "").split(/\s+/)[0];
  const vars = { "--team-primary": b.primary, "--team-ink": b.ink, "--team-accent": b.accent } as CSSProperties;
  const points: Array<[string, string]> = [
    ["Type what you need", "“2027 lefty pitchers within 200 miles, 6'1\" and up.” RC pulls up the players who fit."],
    ["Stats update themselves", "Season stats and schedules from public pages land on each player's profile. No more checking MaxPreps."],
    ["Your board, your staff", "Notes, calls, texts and camp visits in one place, on your phone, with one login for the whole staff."],
    ["Bring your list", "Upload your spreadsheet or snap a photo of your handwritten list. You're set up in minutes."],
  ];
  return (
    <div style={vars} className="team-scope min-h-screen bg-[var(--color-canvas)]">
      <header className="relative overflow-hidden border-b-[6px] border-[var(--team-primary)] bg-[var(--team-ink)] px-4 pb-12 pt-[calc(env(safe-area-inset-top)+2.5rem)] text-white">
        <div aria-hidden className="absolute inset-0 bg-[repeating-linear-gradient(135deg,transparent_0_26px,rgba(255,255,255,0.035)_26px_52px)]" />
        <div className="relative mx-auto max-w-3xl">
          <div className="flex items-center gap-4">
            {b.logoDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={b.logoDataUrl} alt={`${team} logo`} className="h-16 w-auto max-w-[8rem] object-contain sm:h-20 sm:max-w-[10rem]" />
            ) : (
              <span className="font-display grid h-16 w-16 place-items-center bg-[var(--team-primary)] text-4xl font-extrabold sm:h-20 sm:w-20">{team[0]}</span>
            )}
            <div>
              <p className="eyebrow text-white/60">Recruiting Coordinator</p>
              <p className="font-display text-2xl font-extrabold uppercase leading-none sm:text-3xl">{team}</p>
            </div>
          </div>
          <h1 className="font-display mt-8 text-5xl font-extrabold uppercase leading-[0.9] sm:text-7xl">
            {first ? <>Coach {first},<br /></> : null}your recruiting staff<br /><span className="text-[var(--team-accent)]">is ready.</span>
          </h1>
          <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-white/75">We set RC up in {team} colors with sample players near your campus, so you can see exactly how it works for your program. Takes 2 minutes. No sign-up, no card.</p>
          <form action={openPreviewAction} className="mt-7">
            <input type="hidden" name="slug" value={slug} />
            <button className="w-full rounded-[3px] bg-[var(--team-primary)] px-8 py-4 text-[15px] font-bold uppercase tracking-[0.08em] text-white shadow-lg hover:brightness-110 sm:w-auto">Open my demo</button>
          </form>
          <div className="mt-3"><Flash error={sp.error} /></div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="grid gap-px border border-slate-900/10 bg-slate-900/10 sm:grid-cols-2">
          {points.map(([h, t]) => (
            <div key={h} className="bg-white p-5">
              <h2 className="font-display text-2xl font-extrabold uppercase leading-none">{h}</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{t}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 border-l-4 border-[var(--team-primary)] bg-white p-5 text-sm text-slate-700">
          <b>Free for 90 days when you&apos;re ready.</b> No card to start. Your board, notes and contacts stay yours, and you can download them any time. Every number shows where it came from.
        </div>
        <form action={openPreviewAction} className="mt-8 text-center">
          <input type="hidden" name="slug" value={slug} />
          <button className="rounded-[3px] bg-[var(--team-ink)] px-8 py-4 text-[14px] font-bold uppercase tracking-[0.08em] text-white hover:brightness-125">Open the {team} demo</button>
          <p className="mt-2 text-xs text-slate-500">Sample players are fictional. Nothing is sent to anyone.</p>
        </form>
      </main>
      <footer className="pb-10 text-center text-[11px] uppercase tracking-[0.16em] text-slate-400">RC · powered by The Athlete Market</footer>
    </div>
  );
}
