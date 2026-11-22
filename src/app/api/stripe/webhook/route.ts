// Stripe webhook: Stripe calls this when a trial starts, a payment succeeds
// or fails, or a subscription changes. Every request is signature-checked.
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { applyStripeEvent, getStripe } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return NextResponse.json({ error: "billing not configured" }, { status: 503 });
  const body = await req.text();
  let event;
  try {
    event = stripe.webhooks.constructEvent(body, req.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }
  const r = await applyStripeEvent(await getDb(), event);
  return NextResponse.json({ received: true, applied: r.applied });
}
