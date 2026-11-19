// Outreach drafting. Drafts are assembled ONLY from facts RC has on record,
// and verified facts are preferred. Unverified numbers are never quoted back
// to a recruit as if RC had confirmed them. Every draft goes to the coach.

import { metricDef } from "./metrics";
import type { ResolvedMetric } from "./provenance";
import type { MessageKind } from "./compliance";

export interface DraftContext {
  kind: MessageKind;
  athlete: { firstName: string; lastName: string; gradYear: number | null; primaryPosition: string | null; highSchool: string | null };
  program: { name: string; coachName: string; coachTitle?: string };
  metrics: ResolvedMetric[];
  camp?: { name: string; startsAt: string; location: string | null; registrationUrl: string | null } | null;
  upcomingGame?: { opponent: string | null; startsAt: string } | null;
}

export interface Draft {
  subject: string;
  body: string;
  factsUsed: string[];
}

export function draftMessage(c: DraftContext): Draft {
  const first = c.athlete.firstName;
  const pos = c.athlete.primaryPosition ? `${c.athlete.primaryPosition} ` : "";
  const cls = c.athlete.gradYear ? `class of ${c.athlete.gradYear}` : "";
  const factsUsed: string[] = [];

  // Only verified, non-sensitive metrics are mentioned in outreach.
  const verified = c.metrics.filter((m) => m.verifiedBadge && !metricDef(m.key).sensitive).slice(0, 2);
  const metricLine = verified.length
    ? `I noticed your ${verified
        .map((m) => {
          const d = metricDef(m.key);
          factsUsed.push(`${d.label}: ${d.format(m.primary.value)} (${m.primary.sourceName})`);
          return `${d.label.toLowerCase()} of ${d.format(m.primary.value)} at ${m.primary.sourceName}`;
        })
        .join(" and ")}. `
    : "";

  if (c.athlete.highSchool) factsUsed.push(`School: ${c.athlete.highSchool}`);
  if (c.athlete.gradYear) factsUsed.push(`Class: ${c.athlete.gradYear}`);

  const sig = `\n\n${c.program.coachName}${c.program.coachTitle ? `\n${c.program.coachTitle}` : ""}\n${c.program.name}`;
  const school = c.athlete.highSchool ? ` at ${c.athlete.highSchool}` : "";

  switch (c.kind) {
    case "camp_invite": {
      const camp = c.camp;
      const when = camp ? new Date(camp.startsAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "";
      if (camp) factsUsed.push(`Camp: ${camp.name} on ${when}`);
      return {
        subject: camp ? `${c.program.name}: invitation to ${camp.name}` : `${c.program.name} camp invitation`,
        body:
          `Hi ${first},\n\nOur staff has been following ${pos ? `${pos.trim()} prospects` : "prospects"} in the ${cls || "upcoming classes"}${school ? `, including you${school}` : ""}. ${metricLine}` +
          `We'd like to invite you to ${camp ? `${camp.name} on ${when}${camp.location ? ` at ${camp.location}` : ""}` : "our upcoming camp"}. ` +
          `It's a great chance to work with our staff and see our program up close.` +
          (camp?.registrationUrl ? `\n\nRegistration: ${camp.registrationUrl}` : "") +
          sig,
        factsUsed,
      };
    }
    case "film_request":
      return {
        subject: `${c.program.name}: updated film request`,
        body: `Hi ${first},\n\nThanks for your interest in ${c.program.name}. Could you send us your most recent game or skills film${pos ? ` as a ${pos.trim()}` : ""}? A link to full at-bats or a recent showcase works great.${sig}`,
        factsUsed,
      };
    case "schedule_request":
      return {
        subject: `${c.program.name}: upcoming schedule`,
        body: `Hi ${first},\n\nWe'd like to see you play this season. Could you send your upcoming game and tournament schedule, including team name and venues?${sig}`,
        factsUsed,
      };
    case "follow_up":
      return {
        subject: `Following up — ${c.program.name}`,
        body: `Hi ${first},\n\nFollowing up on my earlier note. We continue to follow your progress${school}. ${metricLine}Let me know if you have any questions about our program.${sig}`,
        factsUsed,
      };
    case "general":
      return {
        subject: `News from ${c.program.name}`,
        body: `Hi ${first},\n\n[Program update]${sig}`,
        factsUsed,
      };
    case "initial":
    default:
      return {
        subject: `${c.program.name} recruiting — ${c.athlete.firstName} ${c.athlete.lastName}`,
        body:
          `Hi ${first},\n\nMy name is ${c.program.coachName} and I'm with ${c.program.name}. We've been evaluating ${pos}${cls ? `${cls} ` : ""}prospects${school ? `, and you${school} stood out to our staff` : ""}. ${metricLine}` +
          (c.upcomingGame ? `We hope to see you play${c.upcomingGame.opponent ? ` against ${c.upcomingGame.opponent}` : ""}. ` : "") +
          `We'd like to learn more about you and your goals.${sig}`,
        factsUsed,
      };
  }
}
