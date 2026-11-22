// Subscription rules. Every school subscribes. New schools get a free trial
// (card on file, charged automatically when the trial ends — handled by
// Stripe). Billing is only enforced once RC's Stripe keys are configured, so
// nobody is locked out before payments are set up.

import type { Db } from "../db";
import { getOrg, type Org } from "../repo";

export const TRIAL_DAYS = () => Math.max(0, Number(process.env.RC_TRIAL_DAYS ?? 90));

export function billingEnforced(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && (env.STRIPE_PRICE_MONTHLY || env.STRIPE_PRICE_YEARLY));
}

export interface BillingState {
  /** Can use RC right now. */
  active: boolean;
  /** "demo" | "not_enforced" | "comp" | "invoice" | "trialing" | "active" | "past_due" | "needs_subscription" | "ended" */
  reason: string;
  trialing: boolean;
  daysLeftInTrial: number | null;
  message: string;
  warning: string | null;
}

const days = (iso: string, now: number) => Math.ceil((Date.parse(iso) - now) / 86_400_000);

export function billingState(org: Org, now = Date.now(), env: Record<string, string | undefined> = process.env): BillingState {
  const p = org.settings.plan;
  const base = { trialing: false, daysLeftInTrial: null, warning: null };
  if (org.isDemo) return { ...base, active: true, reason: "demo", message: "Demo program" };
  if (p.comp) return { ...base, active: true, reason: "comp", message: "Complimentary access" };
  if (p.paidThrough && Date.parse(p.paidThrough) > now) return { ...base, active: true, reason: "invoice", message: `Paid by invoice through ${p.paidThrough.slice(0, 10)}` };
  if (!billingEnforced(env)) return { ...base, active: true, reason: "not_enforced", message: "Billing isn't set up yet" };
  if (p.status === "trialing") {
    const left = p.trialEndsAt ? days(p.trialEndsAt, now) : null;
    return {
      active: true, reason: "trialing", trialing: true, daysLeftInTrial: left,
      message: left != null ? `Free trial · ${left} day${left === 1 ? "" : "s"} left` : "Free trial",
      warning: left != null && left <= 7 ? `Your free trial ends in ${left} day${left === 1 ? "" : "s"}. Your card on file will be charged automatically${p.cancelAtPeriodEnd ? "… unless canceled (cancellation is scheduled)" : ""}.` : null,
    };
  }
  if (p.status === "active") return { ...base, active: true, reason: "active", message: p.cancelAtPeriodEnd && p.currentPeriodEnd ? `Subscribed · ends ${p.currentPeriodEnd.slice(0, 10)}` : `Subscribed${p.interval ? ` (${p.interval === "year" ? "yearly" : "monthly"})` : ""}`, warning: p.cancelAtPeriodEnd && p.currentPeriodEnd ? `Your subscription is set to end on ${p.currentPeriodEnd.slice(0, 10)}.` : null };
  if (p.status === "past_due") return { ...base, active: true, reason: "past_due", message: "Payment issue", warning: "Your last payment didn't go through. Update your card in Billing to keep RC running." };
  if (p.status === "none" || p.status === "incomplete" || p.status === "incomplete_expired") {
    return { ...base, active: false, reason: "needs_subscription", message: p.trialUsed ? "Subscribe to continue" : `Start your ${TRIAL_DAYS()}-day free trial` };
  }
  return { ...base, active: false, reason: "ended", message: "Your subscription has ended" };
}

export async function orgIsActive(db: Db, orgId: string): Promise<boolean> {
  return billingState(await getOrg(db, orgId)).active;
}
