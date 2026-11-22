// AI research is included in every subscription, with a monthly check limit
// (lower during the free trial). It runs only while the school's
// subscription is active.

import type { Db } from "../db";
import type { Org } from "../repo";
import { billingState } from "../billing/plan";

export const TRIAL_MONTHLY_CHECKS = () => Math.max(0, Number(process.env.RC_AI_TRIAL_MONTHLY ?? 200));

export interface AiAccess {
  canRun: boolean;
  automatic: boolean;
  usedThisMonth: number;
  monthlyLimit: number;
  message: string;
}

export async function aiAccess(db: Db, org: Org): Promise<AiAccess> {
  const billing = billingState(org);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const row = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM agent_runs WHERE org_id = ? AND ran_at >= ? AND status NOT IN ('error', 'not_configured', 'not_included')", [org.id, monthStart.toISOString()]);
  const usedThisMonth = Number(row?.n ?? 0);
  if (!billing.active) return { canRun: false, automatic: false, usedThisMonth, monthlyLimit: 0, message: "AI research is part of your RC subscription. Subscribe to turn it back on." };
  const monthlyLimit = billing.trialing ? Math.min(TRIAL_MONTHLY_CHECKS(), org.settings.plan.aiMonthlyLimit) : org.settings.plan.aiMonthlyLimit;
  const left = monthlyLimit - usedThisMonth;
  return {
    canRun: left > 0, automatic: left > 0, usedThisMonth, monthlyLimit,
    message: left > 0 ? `${usedThisMonth} of ${monthlyLimit} AI checks used this month${billing.trialing ? " (free trial)" : ""}` : `This month's ${monthlyLimit} AI checks are used up. They reset on the 1st.`,
  };
}
