import Link from "next/link";
import type { CSSProperties } from "react";
import { requireSession } from "@/lib/session";
import { billingEnforced, billingState, TRIAL_DAYS } from "@/lib/billing/plan";
import { getStripe, priceFor } from "@/lib/billing/stripe";
import { can } from "@/lib/domain/permissions";
import { billingPortalAction, logoutAction, startCheckoutAction } from "@/app/actions";
import { Flash } from "@/components/ui";
import { brandingVars } from "@/lib/theme";

export const dynamic = "force-dynamic";

async function priceLabel(interval: "month" | "year"): Promise<string | null> {
  const id = priceFor(interval);
  const stripe = getStripe();
  if (!id || !stripe) return null;
  try {
    const p = await stripe.prices.retrieve(id);
    if (p.unit_amount == null) return null;
    const dollars = (p.unit_amount / 100).toLocaleString("en-US", { minimumFractionDigits: p.unit_amount % 100 ? 2 : 0 });
    return "$" + dollars + (interval === "year" ? "/year" : "/month");
  } catch {
    return null;
  }
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ success?: string; error?: string }> }) {
  const { ctx, org, user } = await requireSession({ allowInactive: true });
  const sp = await searchParams;
  const state = billingState(org);
  const p = org.settings.plan;
  const b = org.settings.branding;
  const team = b.teamName ?? org.name;
  const vars = brandingVars(b) as CSSProperties;
  const isAdmin = can(user.role, "manage_settings");
  const [monthly, yearly] = await Promise.all([priceLabel("month"), priceLabel("year")]);
  const stats = await ctx.db.get<{ players: number; contacts: number; checks: number; updates: number }>(
    `SELECT (SELECT COUNT(*) FROM follows WHERE org_id = ?) AS players,
            (SELECT COUNT(*) FROM contacts WHERE org_id = ?) AS contacts,
            (SELECT COUNT(*) FROM agent_runs WHERE org_id = ? AND status != 'photo_import') AS checks,
            (SELECT COUNT(*) FROM events WHERE org_id = ? AND type IN ('metric_updated','schedule_changed','game_identified')) AS updates`,
    [org.id, org.id, org.id, org.id],
  );
  const subscribed = ["trialing", "active", "past_due"].includes(p.status) && Boolean(p.stripeCustomerId);
  const tiles: Array<[string, number]> = [
    ["Players on your board", Number(stats?.players ?? 0)],
    ["Contacts logged", Number(stats?.contacts ?? 0)],
    ["Stat & schedule updates", Number(stats?.updates ?? 0)],
    ["AI research checks", Number(stats?.checks ?? 0)],
  ];
  return (
    <div style={vars} className="team-scope min-h-screen bg-[var(--color-canvas)] pb-16">
      <header className="border-b-4 border-[var(--team-primary)] bg-[var(--team-ink)] pt-[env(safe-area-inset-top)] text-white">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
          <span className="font-display text-2xl font-extrabold uppercase">{team}</span>
          <div className="flex items-center gap-4 text-xs uppercase tracking-wider">
            <Link href="/" className="text-white/80 hover:text-white">Back to RC</Link>
            <form action={logoutAction}><button className="text-white/60 hover:text-white">Sign out</button></form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Flash flash={sp.success ? "You're all set. It can take a few seconds for your plan to update here." : undefined} error={sp.error} />
        <h1 className="font-display text-5xl font-extrabold uppercase leading-none">Billing</h1>
        <p className="mt-2 text-[15px] text-slate-600">
          <b>{state.message}</b>
          {p.trialEndsAt && state.trialing ? ` · trial ends ${p.trialEndsAt.slice(0, 10)}${p.stripeSubscriptionId ? ", then your card is charged automatically" : ""}` : ""}
          {p.currentPeriodEnd && p.status === "active" && !p.cancelAtPeriodEnd ? ` · renews ${p.currentPeriodEnd.slice(0, 10)}` : ""}
        </p>
        {state.warning && <p className="mt-3 border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-950">{state.warning}</p>}

        {tiles.some(([, n]) => n > 0) && <div className="mt-6 grid grid-cols-2 gap-px border border-slate-900/10 bg-slate-900/10 sm:grid-cols-4">
          {tiles.map(([label, n]) => (
            <div key={label} className="bg-white p-4">
              <div className="font-display text-4xl font-extrabold">{n}</div>
              <div className="eyebrow mt-1 text-slate-500">{label}</div>
            </div>
          ))}
        </div>}

        <div className="mt-6 border border-slate-900/10 bg-white p-5 text-sm text-slate-700">
          <h2 className="font-display text-2xl font-extrabold uppercase">What&apos;s always free</h2>
          <p className="mt-1">Your board, player profiles, notes, contact log, search, imports and exports. <b>RC never locks your data.</b></p>
          <h2 className="font-display mt-4 text-2xl font-extrabold uppercase">What a subscription runs</h2>
          <p className="mt-1">The automatic staff work: AI research on your players, daily saved searches, automatic stat and schedule updates, and finding players&apos; pages and links.</p>
        </div>

        {!billingEnforced() ? (
          <p className="mt-6 text-sm text-slate-600">Billing isn&apos;t set up for RC yet, so everything is open. Nothing to do here.</p>
        ) : state.reason === "comp" || state.reason === "invoice" || state.reason === "demo" ? (
          <p className="mt-6 text-sm text-slate-600">Your access is managed by the RC team ({state.message.toLowerCase()}). Questions? Reply to any RC email.</p>
        ) : subscribed ? (
          isAdmin ? (
            <form action={billingPortalAction} className="mt-6">
              <button className="rounded-[3px] bg-brand-600 px-5 py-3 text-[13px] font-bold uppercase tracking-[0.06em] text-on-brand hover:bg-brand-700">Update card, switch plan or cancel</button>
              <p className="mt-2 text-xs text-slate-500">Opens Stripe&apos;s secure billing page. RC never sees your card number.</p>
            </form>
          ) : (
            <p className="mt-6 text-sm text-slate-600">Your head coach manages billing.</p>
          )
        ) : isAdmin ? (
          <div className="mt-6">
            <h2 className="font-display text-3xl font-extrabold uppercase">{p.trialUsed ? (state.trialing ? "Keep the automatic updates after your trial" : "Turn the automatic updates back on") : `Start your ${TRIAL_DAYS()}-day free trial`}</h2>
            <p className="mt-1 text-sm text-slate-600">
              {p.trialUsed ? (state.trialing && state.daysLeftInTrial ? `Add a card now and you still get your ${state.daysLeftInTrial} free days. Nothing is charged until your trial ends. Cancel any time.` : "Pick a plan. You can cancel any time, and your board stays free either way.") : `Nothing is charged today. After ${TRIAL_DAYS()} days your card is charged automatically. Cancel any time before then and you won't pay.`}
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {(["year", "month"] as const).filter((i) => priceFor(i)).map((i) => (
                <form key={i} action={startCheckoutAction} className="border border-slate-900/10 border-t-4 border-t-[var(--team-primary)] bg-white p-5">
                  <input type="hidden" name="interval" value={i} />
                  <div className="eyebrow text-slate-500">{i === "year" ? "Yearly" : "Monthly"}</div>
                  <div className="font-display mt-1 text-4xl font-extrabold">{(i === "year" ? yearly : monthly) ?? (i === "year" ? "Yearly plan" : "Monthly plan")}</div>
                  <p className="mt-1 text-xs text-slate-500">{i === "year" ? "Best for athletic departments paying once a year." : "Pay month to month."}</p>
                  <button className="mt-4 w-full rounded-[3px] bg-brand-600 px-4 py-3 text-[13px] font-bold uppercase tracking-[0.06em] text-on-brand hover:bg-brand-700">{p.trialUsed ? (state.trialing ? "Add card · keep it running" : "Subscribe") : "Start free trial"}</button>
                </form>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500">Secure checkout by Stripe. Promo codes accepted. Paying by invoice or purchase order? Reply to your RC email and we&apos;ll set it up.</p>
          </div>
        ) : (
          <p className="mt-6 text-sm text-slate-600">Your head coach manages the subscription. Your players, notes and contacts are always yours to use.</p>
        )}
      </main>
    </div>
  );
}
