// Who can use AI research. RC is free; AI research is a paid add-on per
// school. Every school gets a small free trial of manual checks so coaches
// can see the value. Automatic board-wide research needs the add-on.

import type { Db } from "../db";
import type { Org } from "../repo";

export const TRIAL_CHECKS = () => Math.max(0, Number(process.env.RC_AI_TRIAL_CHECKS ?? 25));

export interface AiAccess {
  /** May run a check right now (manual). */
  canRun: boolean;
  /** Automatic scheduled research for the whole board. */
  automatic: boolean;
  mode: "addon" | "trial" | "none";
  usedThisMonth: number;
  monthlyLimit: number;
  trialUsed: number;
  trialTotal: number;
  message: string;
}

export async function aiAccess(db: Db, org: Org): Promise<AiAccess> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const counted = "status NOT IN ('error', 'not_configured')"; // failed runs don't count against a school
  const month = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM agent_runs WHERE org_id = ? AND ran_at >= ? AND ${counted}`, [org.id, monthStart.toISOString()]);
  const ever = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM agent_runs WHERE org_id = ? AND ${counted}`, [org.id]);
  const usedThisMonth = Number(month?.n ?? 0);
  const trialUsed = Number(ever?.n ?? 0);
  const trialTotal = TRIAL_CHECKS();
  const p = org.settings.plan;
  if (p.aiResearch) {
    const left = p.aiMonthlyLimit - usedThisMonth;
    return {
      canRun: left > 0, automatic: left > 0, mode: "addon", usedThisMonth, monthlyLimit: p.aiMonthlyLimit, trialUsed, trialTotal,
      message: left > 0 ? `AI research add-on active · ${usedThisMonth} of ${p.aiMonthlyLimit} checks used this month` : `Monthly AI research limit reached (${p.aiMonthlyLimit}). It resets on the 1st.`,
    };
  }
  const trialLeft = Math.max(0, trialTotal - trialUsed);
  return {
    canRun: trialLeft > 0, automatic: false, mode: trialLeft > 0 ? "trial" : "none", usedThisMonth, monthlyLimit: 0, trialUsed, trialTotal,
    message: trialLeft > 0 ? `Free trial: ${trialLeft} of ${trialTotal} AI checks left` : `You've used all ${trialTotal} free AI checks. Add AI research to keep your board updated automatically.`,
  };
}
