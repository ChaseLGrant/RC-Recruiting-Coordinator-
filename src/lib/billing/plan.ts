// Subscription rules — coaches first.
//
// • A coach's board is NEVER locked: players, notes, contacts, search, imports
//   and exports always work, paid or not.
// • What a subscription pays for is RC's automatic staff work (AI research,
//   daily searches, automatic stat/schedule tracking, the page finder) —
//   the part that actually costs money to run.
// • Every school starts with a free trial of that automation the first time
//   anyone signs in. No card. (Set RC_TRIAL_REQUIRES_CARD=true to require a
//   card at the start instead.)
// • Nothing is charged or paused until RC's Stripe keys are configured.

import type { Db } from "../db";
import { getOrg, updateOrgSettings, type Org } from "../repo";

export const TRIAL_DAYS = () => Math.max(0, Number(process.env.RC_TRIAL_DAYS ?? 90));
export const trialRequiresCard = (env: Record<string, string | undefined> = process.env) => env.RC_TRIAL_REQUIRES_CARD === "true";

export function billingEnforced(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && (env.STRIPE_PRICE_MONTHLY || env.STRIPE_PRICE_YEARLY));
}

export interface BillingState {
  /** RC's automatic staff work runs (AI research, scheduled searches, stat tracking, page finder). The board itself is always usable. */
  active: boolean;
  /** "demo" | "not_enforced" | "comp" | "invoice" | "trialing" | "active" | "past_due" | "needs_subscription" | "free" */
  reason: string;
  trialing: boolean;
  daysLeftInTrial: number | null;
  message: string;
  /** Gentle banner text; never a lock. */
  warning: string | null;
}

const days = (iso: string, now: number) => Math.ceil((Date.parse(iso) - now) / 86_400_000);

export function billingState(org: Org, now = Date.now(), env: Record<string, string | undefined> = process.env): BillingState {
  const p = org.settings.plan;
  const base = { trialing: false, daysLeftInTrial: null, warning: null };
  if (org.isDemo) return { ...base, active: true, reason: "demo", message: "Demo program" };
  if (p.comp) return { ...base, active: true, reason: "comp", message: "Complimentary access" };
  if (p.paidThrough && Date.parse(p.paidThrough) > now) return { ...base, active: true, reason: "invoice", message: `Paid by invoice through ${p.paidThrough.slice(0, 10)}` };
  if (!billingEnforced(env)) return { ...base, active: true, reason: "not_enforced", message: "Everything is included" };

  const hasCard = Boolean(p.stripeSubscriptionId);
  if (p.status === "trialing") {
    const left = p.trialEndsAt ? days(p.trialEndsAt, now) : null;
    if (left != null && left <= 0 && !hasCard) {
      return { ...base, active: false, reason: "free", message: "Free plan · automatic updates paused", warning: "Your free trial of RC's automatic updates has ended. Your board, notes and contacts are all still here and free to use. Subscribe any time to turn the automatic updates back on." };
    }
    const soon = left != null && left <= 10;
    return {
      active: true, reason: "trialing", trialing: true, daysLeftInTrial: left,
      message: left != null ? `Free trial · ${left} day${left === 1 ? "" : "s"} left` : "Free trial",
      warning: !soon ? null : hasCard
        ? `Your free trial ends in ${left} day${left === 1 ? "" : "s"}. Your card on file will be charged automatically${p.cancelAtPeriodEnd ? " unless you've canceled" : ""}.`
        : `Your free trial of RC's automatic updates ends in ${left} day${left === 1 ? "" : "s"}. Your board stays free. Subscribe to keep RC researching and updating your players.`,
    };
  }
  if (p.status === "active") return { ...base, active: true, reason: "active", message: p.cancelAtPeriodEnd && p.currentPeriodEnd ? `Subscribed · ends ${p.currentPeriodEnd.slice(0, 10)}` : `Subscribed${p.interval ? ` (${p.interval === "year" ? "yearly" : "monthly"})` : ""}`, warning: p.cancelAtPeriodEnd && p.currentPeriodEnd ? `Your subscription is set to end on ${p.currentPeriodEnd.slice(0, 10)}. Your board stays free after that.` : null };
  if (p.status === "past_due") return { ...base, active: true, reason: "past_due", message: "Payment issue", warning: "Your last payment didn't go through. Update your card in Billing to keep the automatic updates running." };
  if (p.status === "none" && !p.trialUsed) {
    return { ...base, active: false, reason: "needs_subscription", message: `Start your ${TRIAL_DAYS()}-day free trial`, warning: trialRequiresCard(env) ? `Start your ${TRIAL_DAYS()}-day free trial to turn on RC's automatic updates.` : null };
  }
  return { ...base, active: false, reason: "free", message: "Free plan · automatic updates paused", warning: "RC's automatic updates are paused. Your board, notes and contacts are all still here. Subscribe any time to turn them back on." };
}

/** Starts the no-card free trial the first time a school uses RC (unless a card is required). */
export async function ensureTrialStarted(db: Db, org: Org): Promise<Org> {
  const p = org.settings.plan;
  if (org.isDemo || p.trialUsed || p.status !== "none" || trialRequiresCard()) return org;
  const ends = new Date(Date.now() + TRIAL_DAYS() * 86_400_000).toISOString();
  await updateOrgSettings({ db, orgId: org.id, userId: null, role: "system" }, { plan: { ...p, status: "trialing", trialEndsAt: ends, trialUsed: true } });
  return getOrg(db, org.id);
}

export async function orgIsActive(db: Db, orgId: string): Promise<boolean> {
  return billingState(await getOrg(db, orgId)).active;
}

/** Work that costs real money per call (web search, page fetching, AI): active schools only, never demos (their players are fictional). */
export async function orgCanUsePaidServices(db: Db, orgId: string): Promise<boolean> {
  const org = await getOrg(db, orgId);
  return !org.isDemo && billingState(org).active;
}
