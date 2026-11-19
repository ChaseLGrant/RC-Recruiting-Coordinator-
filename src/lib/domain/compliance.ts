// Communication eligibility. RC does not hard-code NCAA rules (they vary by
// sport and division and change often). Instead each program's compliance
// office configures them, and when RC can't be sure a message is allowed it
// routes the draft to compliance review rather than guessing.

export interface CalendarPeriod {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD inclusive
  type: "contact" | "evaluation" | "quiet" | "dead";
  note?: string;
}

export interface ComplianceSettings {
  configured: boolean;
  division: string | null;
  /** First date recruiting communication is permitted, per graduation year: { "2027": "2025-08-01" } */
  firstContactDateByGradYear: Record<string, string>;
  calendar: CalendarPeriod[];
  /** Require recorded parent/guardian consent before messaging athletes under 18. */
  requireGuardianConsentForMinors: boolean;
  /** Camp brochures/general program info may have different rules; compliance decides. */
  campMaterialsAllowedBeforeContactDate: boolean;
}

export const DEFAULT_COMPLIANCE: ComplianceSettings = {
  configured: false,
  division: null,
  firstContactDateByGradYear: {},
  calendar: [],
  requireGuardianConsentForMinors: true,
  campMaterialsAllowedBeforeContactDate: false,
};

export type MessageKind = "initial" | "follow_up" | "camp_invite" | "film_request" | "schedule_request" | "general";

export interface RecipientFacts {
  gradYear: number | null;
  email: string | null;
  guardianEmail: string | null;
  optedOut: boolean;
  /** "granted" | "denied" | "unknown" */
  contactConsent: "granted" | "denied" | "unknown";
  isMinor: boolean | null;
}

export type EligibilityStatus = "eligible" | "compliance_review" | "blocked";

export interface Eligibility {
  status: EligibilityStatus;
  reasons: string[];
}

export function periodOn(date: string, calendar: CalendarPeriod[]): CalendarPeriod | null {
  const d = date.slice(0, 10);
  return calendar.find((p) => p.start <= d && d <= p.end) ?? null;
}

export function checkEligibility(
  kind: MessageKind,
  r: RecipientFacts,
  s: ComplianceSettings,
  today: string = new Date().toISOString().slice(0, 10),
): Eligibility {
  const blocked: string[] = [];
  const review: string[] = [];

  if (r.optedOut) blocked.push("Recipient has opted out of communications");
  if (r.contactConsent === "denied") blocked.push("Contact consent was denied");
  if (!r.email && !r.guardianEmail) blocked.push("No email address on record");
  if (blocked.length) return { status: "blocked", reasons: blocked };

  if (!s.configured) {
    review.push("Compliance settings have not been configured for this program");
  } else {
    if (r.gradYear == null) {
      review.push("Graduation year unknown, so the permitted contact date can't be checked");
    } else {
      const first = s.firstContactDateByGradYear[String(r.gradYear)];
      const exempt = kind === "camp_invite" && s.campMaterialsAllowedBeforeContactDate;
      if (!first) review.push(`No permitted-contact date configured for the class of ${r.gradYear}`);
      else if (today < first && !exempt) review.push(`Class of ${r.gradYear} may not be contacted until ${first}`);
    }
    const period = periodOn(today, s.calendar);
    if (period?.type === "dead" || period?.type === "quiet") {
      review.push(`Today falls in a ${period.type} period${period.note ? ` (${period.note})` : ""}`);
    }
  }

  if (r.isMinor !== false && s.requireGuardianConsentForMinors && r.contactConsent !== "granted") {
    review.push(
      r.isMinor === null
        ? "Age unknown and no guardian consent recorded"
        : "Recipient is a minor and no guardian consent is recorded",
    );
  }

  if (review.length) return { status: "compliance_review", reasons: review };
  return { status: "eligible", reasons: ["All configured compliance checks passed"] };
}
