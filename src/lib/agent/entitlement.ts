// AI research is included in every subscription, with a monthly check limit
// (lower during the free trial). It runs only while the school's
// trial or subscription is active. The board itself never locks.

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
  const row = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM agent_runs WHERE org_id = ? AND ran_at >= ? AND status NOT IN ('error', 'not_configured', 'not_included', 'photo_import')", [org.id, monthStart.toISOString()]);
  const usedThisMonth = Number(row?.n ?? 0);
  if (org.isDemo) return { canRun: false, automatic: false, usedThisMonth, monthlyLimit: 0, message: "AI research is off in the demo because the sample players are fictional. In your own program it researches your real players." };
  if (!billing.active) return { canRun: false, automatic: false, usedThisMonth, monthlyLimit: 0, message: "AI research is paused. Your board is still free to use. Subscribe any time to turn AI research back on." };
  const monthlyLimit = billing.trialing ? Math.min(TRIAL_MONTHLY_CHECKS(), org.settings.plan.aiMonthlyLimit) : org.settings.plan.aiMonthlyLimit;
  const left = monthlyLimit - usedThisMonth;
  return {
    canRun: left > 0, automatic: left > 0, usedThisMonth, monthlyLimit,
    message: left > 0 ? `${usedThisMonth} of ${monthlyLimit} AI checks used this month${billing.trialing ? " (free trial)" : ""}` : `This month's ${monthlyLimit} AI checks are used up. They reset on the 1st.`,
  };
}
