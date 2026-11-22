import { afterEach, describe, expect, it } from "vitest";
import Stripe from "stripe";
import { createDb } from "@/lib/db";
import { createProgram } from "@/lib/onboarding";
import { getOrg, listUsers, type Org } from "@/lib/repo";
import { billingState, ensureTrialStarted } from "@/lib/billing/plan";
import { applyStripeEvent } from "@/lib/billing/stripe";
import { acceptInvite, createInvite, createSchool, inviteInfo, isOwner } from "@/lib/billing/schools";
import { authenticate } from "@/lib/auth";
import { runDueMissions } from "@/lib/jobs/runner";
import { aiAccess } from "@/lib/agent/entitlement";

const ENV = { STRIPE_SECRET_KEY: "sk_test_x", STRIPE_PRICE_MONTHLY: "price_m" };
const day = 86_400_000;

function orgWith(plan: Partial<Org["settings"]["plan"]>, isDemo = false): Org {
  return { id: "o", name: "U", sport: "baseball", campus: null, isDemo, settings: { plan: { status: "none", trialEndsAt: null, currentPeriodEnd: null, paidThrough: null, interval: null, cancelAtPeriodEnd: false, trialUsed: false, stripeCustomerId: null, stripeSubscriptionId: null, stripeUpdatedAt: 0, comp: false, aiMonthlyLimit: 400, ...plan } } as Org["settings"] };
}

describe("subscription rules", () => {
  const now = Date.parse("2027-01-10T00:00:00Z");
  it("nothing is locked until Stripe is set up", () => {
    expect(billingState(orgWith({}), now, {}).active).toBe(true);
  });
  it("trials and paid plans run the automation; ended plans fall back to the free board (never locked)", () => {
    expect(billingState(orgWith({}), now, ENV)).toMatchObject({ active: false, reason: "needs_subscription", message: "Start your 90-day free trial" });
    const t = billingState(orgWith({ status: "trialing", trialEndsAt: new Date(now + 5 * day).toISOString() }), now, ENV);
    expect(t).toMatchObject({ active: true, trialing: true, daysLeftInTrial: 5 });
    expect(t.warning).toMatch(/ends in 5 days.*board stays free/); // no card on file: no charge
    const carded = billingState(orgWith({ status: "trialing", stripeSubscriptionId: "sub_1", trialEndsAt: new Date(now + 5 * day).toISOString() }), now, ENV);
    expect(carded.warning).toMatch(/ends in 5 days.*charged automatically/);
    // A no-card trial that has run out: free plan, automation paused.
    expect(billingState(orgWith({ status: "trialing", trialUsed: true, trialEndsAt: new Date(now - day).toISOString() }), now, ENV)).toMatchObject({ active: false, reason: "free" });
    expect(billingState(orgWith({ status: "active", interval: "year" }), now, ENV)).toMatchObject({ active: true, message: "Subscribed (yearly)" });
    expect(billingState(orgWith({ status: "past_due" }), now, ENV).warning).toMatch(/didn't go through/);
    expect(billingState(orgWith({ status: "canceled", trialUsed: true }), now, ENV)).toMatchObject({ active: false, reason: "free" });
  });
  it("owners can grant complimentary or invoice access; demos stay open", () => {
    expect(billingState(orgWith({ comp: true }), now, ENV).active).toBe(true);
    expect(billingState(orgWith({ paidThrough: "2027-06-30T23:59:59Z" }), now, ENV)).toMatchObject({ active: true, reason: "invoice" });
    expect(billingState(orgWith({ paidThrough: "2026-12-31T23:59:59Z" }), now, ENV).active).toBe(false);
    expect(billingState(orgWith({}, true), now, ENV).active).toBe(true);
  });
});

describe("Stripe webhooks", () => {
  afterEach(() => { delete process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_PRICE_MONTHLY; });
  it("verifies signatures and tracks trial → auto-charge → cancel, ignoring out-of-order events", async () => {
    const db = await createDb({ sqlitePath: ":memory:", url: "" });
    const p = await createProgram(db, { programName: "Pay U", coachName: "C", email: "c@pay.test", password: "password123" });
    const stripe = new Stripe("sk_test_x");
    const secret = "whsec_test";
    const send = async (type: string, object: object, created: number) => {
      const payload = JSON.stringify({ id: `evt_${created}`, object: "event", type, created, data: { object } });
      const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
      const event = stripe.webhooks.constructEvent(payload, header, secret); // same check as the live webhook
      return applyStripeEvent(db, event);
    };
    expect(() => stripe.webhooks.constructEvent("{}", "t=1,v1=bad", secret)).toThrow();

    await send("checkout.session.completed", { object: "checkout.session", client_reference_id: p.orgId, customer: "cus_1", subscription: "sub_1", metadata: { orgId: p.orgId } }, 100);
    const sub = (status: string, extra: object = {}) => ({ object: "subscription", id: "sub_1", customer: "cus_1", status, metadata: { orgId: p.orgId }, trial_end: 1800000000, cancel_at_period_end: false, items: { data: [{ current_period_end: 1800000000, price: { recurring: { interval: "month" } } }] }, ...extra });
    await send("customer.subscription.created", sub("trialing"), 101);
    let org = await getOrg(db, p.orgId);
    expect(org.settings.plan).toMatchObject({ status: "trialing", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", trialUsed: true, interval: "month" });
    expect(billingState(org, Date.now(), ENV).active).toBe(true);

    await send("customer.subscription.updated", sub("active"), 200); // trial ended, card charged automatically
    await send("customer.subscription.updated", sub("trialing"), 150); // late, older event: ignored
    org = await getOrg(db, p.orgId);
    expect(org.settings.plan.status).toBe("active");

    await send("customer.subscription.deleted", sub("canceled"), 300);
    org = await getOrg(db, p.orgId);
    expect(billingState(org, Date.now(), ENV)).toMatchObject({ active: false, reason: "free" });

    // Inactive schools: background work pauses and AI stops (no cost).
    Object.assign(process.env, ENV);
    await db.run("INSERT INTO recruiting_profiles (id, org_id, name, criteria_json, created_by, created_at, updated_at) VALUES ('pr', ?, 'x', '{}', 'u', '2026', '2026')", [p.orgId]);
    await db.run("INSERT INTO missions (id, org_id, profile_id, name, schedule, actions_json, active, next_run_at, created_by, created_at) VALUES ('mi', ?, 'pr', 'x', 'daily', '{}', 1, '2000-01-01', 'u', '2026')", [p.orgId]);
    expect(await runDueMissions(db)).toEqual([]);
    expect((await aiAccess(db, org)).canRun).toBe(false);
  });
});

describe("no-card free trial", () => {
  afterEach(() => { delete process.env.RC_TRIAL_REQUIRES_CARD; });
  it("starts automatically the first time a school uses RC, only once, and not when a card is required", async () => {
    const db = await createDb({ sqlitePath: ":memory:", url: "" });
    const orgId = await createSchool(db, { programName: "Test U Baseball", campusZip: "92069" });
    let org = await getOrg(db, orgId);
    expect(org.settings.plan.status).toBe("none");
    org = await ensureTrialStarted(db, org);
    expect(org.settings.plan).toMatchObject({ status: "trialing", trialUsed: true, stripeSubscriptionId: null });
    const left = billingState(org, Date.now(), ENV);
    expect(left).toMatchObject({ active: true, trialing: true, daysLeftInTrial: 90 });
    // Running it again doesn't restart the clock.
    const ends = org.settings.plan.trialEndsAt;
    expect((await ensureTrialStarted(db, org)).settings.plan.trialEndsAt).toBe(ends);

    process.env.RC_TRIAL_REQUIRES_CARD = "true";
    const other = await getOrg(db, await createSchool(db, { programName: "Card U", campusZip: "92069" }));
    expect((await ensureTrialStarted(db, other)).settings.plan.status).toBe("none");
  });
});

describe("school invites", () => {
  it("creates a branded school, and the head coach sets up the staff from a one-time link", async () => {
    const db = await createDb({ sqlitePath: ":memory:", url: "" });
    const orgId = await createSchool(db, { programName: "Palomar College Baseball", teamName: "Palomar Baseball", campusZip: "92069", branding: { primary: "#c8102e", ink: "#141414" } });
    const org = await getOrg(db, orgId);
    expect(org.settings.branding).toMatchObject({ teamName: "Palomar Baseball", primary: "#c8102e" });
    expect(org.isDemo).toBe(false);
    const token = await createInvite(db, orgId, null);
    expect((await inviteInfo(db, token)).ok).toBe(true);
    await expect(acceptInvite(db, token, { name: "Ben Adams", email: "ben@palomar.edu", password: "coach-pass-1", staffLoginEmail: "staff@palomar.edu", staffLoginPassword: "coach-pass-1", staff: [] })).rejects.toThrow(/different password/);
    const r = await acceptInvite(db, token, {
      name: "Ben Adams", email: "ben@palomar.edu", password: "coach-pass-1",
      staffLoginEmail: "staff@palomar.edu", staffLoginPassword: "staff-pass-2",
      staff: [{ name: "Hayden Carter", title: "Pitching Coach" }, { name: "Chase Grant", title: "Outfield Coach" }],
    });
    expect(r.orgId).toBe(orgId);
    expect((await listUsers(db, orgId)).map((u) => `${u.name}:${u.role}`)).toEqual(["Ben Adams:head_coach", "Hayden Carter:assistant_coach", "Chase Grant:assistant_coach"]);
    expect((await authenticate(db, "staff@palomar.edu", "staff-pass-2"))?.isShared).toBe(true);
    expect((await authenticate(db, "staff@palomar.edu", "coach-pass-1"))).toBeNull();
    // One use only.
    expect(await inviteInfo(db, token)).toMatchObject({ ok: false });
    await expect(acceptInvite(db, token, { name: "X", email: "x@x.test", password: "password123" })).rejects.toThrow(/already used/);
    expect((await inviteInfo(db, "made-up-token")).ok).toBe(false);
  });
  it("only listed owners are owners", () => {
    expect(isOwner("Owner@RC.test", { RC_ADMIN_EMAILS: "owner@rc.test, other@rc.test" })).toBe(true);
    expect(isOwner("coach@school.edu", { RC_ADMIN_EMAILS: "owner@rc.test" })).toBe(false);
    expect(isOwner("anyone@x.test", {})).toBe(false);
  });
});
