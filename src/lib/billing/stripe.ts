// Stripe billing: subscription checkout with a free trial (card collected up
// front, charged automatically when the trial ends), the Stripe customer
// portal (update card, switch plan, cancel), and webhook handling that keeps
// each school's plan in sync. Card details never touch RC.

import Stripe from "stripe";
import type { Db } from "../db";
import { audit, getOrg, logEvent, updateOrgSettings, type Ctx, type Org, type Plan } from "../repo";
import { TRIAL_DAYS } from "./plan";

export function getStripe(env: Record<string, string | undefined> = process.env): Stripe | null {
  return env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;
}

export function priceFor(interval: "month" | "year", env: Record<string, string | undefined> = process.env): string | null {
  return (interval === "year" ? env.STRIPE_PRICE_YEARLY : env.STRIPE_PRICE_MONTHLY) || null;
}

export async function createCheckoutUrl(stripe: Stripe, org: Org, opts: { interval: "month" | "year"; email: string; baseUrl: string }): Promise<string> {
  const price = priceFor(opts.interval);
  if (!price) throw new Error(`No ${opts.interval === "year" ? "yearly" : "monthly"} price is set up yet.`);
  const trialDays = org.settings.plan.trialUsed ? 0 : TRIAL_DAYS();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    // Card is collected now; Stripe charges it automatically when the trial ends.
    payment_method_collection: "always",
    subscription_data: { ...(trialDays > 0 ? { trial_period_days: trialDays } : {}), metadata: { orgId: org.id } },
    client_reference_id: org.id,
    metadata: { orgId: org.id },
    ...(org.settings.plan.stripeCustomerId ? { customer: org.settings.plan.stripeCustomerId } : { customer_email: opts.email }),
    allow_promotion_codes: true,
    success_url: `${opts.baseUrl}/billing?success=1`,
    cancel_url: `${opts.baseUrl}/billing`,
  });
  if (!session.url) throw new Error("Stripe didn't return a checkout page.");
  return session.url;
}

export async function createPortalUrl(stripe: Stripe, org: Org, baseUrl: string): Promise<string> {
  if (!org.settings.plan.stripeCustomerId) throw new Error("No billing account yet.");
  const s = await stripe.billingPortal.sessions.create({ customer: org.settings.plan.stripeCustomerId, return_url: `${baseUrl}/billing` });
  return s.url;
}

const iso = (unix: number | null | undefined) => (unix ? new Date(unix * 1000).toISOString() : null);

/** Applies one verified Stripe event to the matching school. Safe to receive twice or out of order. */
export async function applyStripeEvent(db: Db, event: Stripe.Event): Promise<{ orgId: string | null; applied: boolean }> {
  const sys = (orgId: string): Ctx => ({ db, orgId, userId: null, role: "system" });
  const findOrg = async (orgId: string | null | undefined, subId?: string | null, customerId?: string | null): Promise<Org | null> => {
    if (orgId) {
      try { return await getOrg(db, orgId); } catch { /* fall through */ }
    }
    const rows = await db.all<{ id: string }>("SELECT id FROM orgs");
    for (const r of rows) {
      const o = await getOrg(db, r.id);
      if ((subId && o.settings.plan.stripeSubscriptionId === subId) || (customerId && o.settings.plan.stripeCustomerId === customerId)) return o;
    }
    return null;
  };

  if (event.type === "checkout.session.completed") {
    const s = event.data.object as Stripe.Checkout.Session;
    const org = await findOrg(s.client_reference_id ?? s.metadata?.orgId);
    if (!org) return { orgId: null, applied: false };
    const plan: Plan = {
      ...org.settings.plan,
      stripeCustomerId: typeof s.customer === "string" ? s.customer : s.customer?.id ?? org.settings.plan.stripeCustomerId,
      stripeSubscriptionId: typeof s.subscription === "string" ? s.subscription : s.subscription?.id ?? org.settings.plan.stripeSubscriptionId,
    };
    await updateOrgSettings(sys(org.id), { plan });
    await audit(sys(org.id), "billing_checkout_completed", "org", org.id);
    return { orgId: org.id, applied: true };
  }

  if (event.type.startsWith("customer.subscription.")) {
    const sub = event.data.object as Stripe.Subscription;
    const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    const org = await findOrg(sub.metadata?.orgId, sub.id, customerId);
    if (!org) return { orgId: null, applied: false };
    if (event.created < org.settings.plan.stripeUpdatedAt) return { orgId: org.id, applied: false }; // older than what we have
    const item = sub.items?.data?.[0];
    const status = (event.type === "customer.subscription.deleted" ? "canceled" : sub.status) as Plan["status"];
    const before = org.settings.plan.status;
    const plan: Plan = {
      ...org.settings.plan,
      status,
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      trialEndsAt: iso(sub.trial_end),
      currentPeriodEnd: iso(item?.current_period_end ?? null),
      interval: (item?.price?.recurring?.interval as "month" | "year" | undefined) ?? org.settings.plan.interval,
      cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
      trialUsed: org.settings.plan.trialUsed || Boolean(sub.trial_end),
      stripeUpdatedAt: event.created,
    };
    await updateOrgSettings(sys(org.id), { plan });
    if (before !== status) {
      await audit(sys(org.id), `billing_${status}`, "org", org.id, { from: before });
      if (status === "past_due") await logEvent(db, org.id, { type: "job_failed", message: "Your last RC payment didn't go through. Update your card in Billing." });
    }
    return { orgId: org.id, applied: true };
  }
  return { orgId: null, applied: false };
}
