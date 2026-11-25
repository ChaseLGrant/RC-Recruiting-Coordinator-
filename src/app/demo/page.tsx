import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/site/chrome";
import { DemoForm } from "@/components/site/demo-form";
import { BOOKING_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "See RC for your program",
  description: "Build a private RC demo in your school's colors, with sample players near your campus. About 30 seconds, no sign-up.",
};

export default async function DemoPage({ searchParams }: { searchParams: Promise<{ school?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="site min-h-screen overflow-x-clip">
      <SiteNav />
      <main className="mx-auto max-w-7xl px-5 pb-24 pt-12 sm:px-8 sm:pt-16">
        <p className="rise eyebrow text-[var(--site-brass)]">See RC for your program</p>
        <h1 className="rise rise-1 font-display mt-4 max-w-4xl text-[3rem] font-extrabold uppercase leading-[0.88] sm:text-7xl">Your colors. Your campus.<br className="hidden sm:block" /> Your board, in 30 seconds.</h1>
        <p className="rise rise-2 mt-5 max-w-2xl text-[16px] leading-relaxed text-[var(--site-muted)]">Tell us your program and pick your colors. RC builds a private demo with sample players near your campus and a week of staff work already done, then drops you straight onto the board.</p>
        <div className="rise rise-3 mt-12">
          <DemoForm initialSchool={(sp.school ?? "").slice(0, 60)} />
        </div>
        <p className="mt-16 border-t border-[var(--site-line)] pt-6 text-sm text-[var(--site-muted)]">
          Rather have someone walk your staff through it? <a href={BOOKING_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-[var(--site-text)] underline decoration-white/30 underline-offset-4 hover:decoration-white">Book a 30-minute demo</a> · Already on RC? <Link href="/login" className="font-semibold text-[var(--site-text)] underline decoration-white/30 underline-offset-4 hover:decoration-white">Sign in</Link>
        </p>
      </main>
    </div>
  );
}
