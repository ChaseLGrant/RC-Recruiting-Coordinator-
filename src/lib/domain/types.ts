// Core domain types for RC. These are shared by the database layer, the job
// runner and the UI. Nothing in here makes a recruiting judgment: every type
// describes facts, where they came from, or a coach's own standards.

export type Verification =
  | "independently_verified" // measured by an independent third party (e.g. a showcase with timing equipment)
  | "official" // officially published by a team, league or governing body
  | "self_reported" // supplied by the athlete, family or their coach
  | "unverified"; // origin unknown or not yet confirmed

export const VERIFICATION_RANK: Record<Verification, number> = {
  independently_verified: 3,
  official: 2,
  self_reported: 1,
  unverified: 0,
};

export const VERIFICATION_LABEL: Record<Verification, string> = {
  independently_verified: "Independently verified",
  official: "Officially published",
  self_reported: "Self-reported",
  unverified: "Unverified",
};

export type Role = "head_coach" | "assistant_coach" | "compliance" | "viewer";

export const ROLE_LABEL: Record<Role, string> = {
  head_coach: "Head coach / admin",
  assistant_coach: "Assistant coach",
  compliance: "Compliance officer",
  viewer: "Viewer",
};

export interface MetricObservation {
  id: string;
  athleteId: string;
  sourceId: string;
  sourceName: string;
  sourceKind: SourceKind;
  metricKey: string;
  value: number;
  unit: string;
  measuredAt: string | null; // ISO date the measurement was taken
  checkedAt: string; // ISO timestamp RC last checked the source
  verification: Verification;
  sourceUrl: string | null;
}

export type SourceKind = "licensed_api" | "import" | "manual" | "demo";

export type Importance = "required" | "preferred" | "optional";

export interface MetricCriterion {
  key: string;
  op: "gte" | "lte";
  value: number;
  importance: Importance;
  /** When true, self-reported / unverified values do not satisfy this criterion. */
  verifiedOnly?: boolean;
}

export interface LocationCriterion {
  mode: "nationwide" | "radius" | "states";
  center?: { label: string; lat: number; lng: number };
  radiusMi?: number;
  states?: string[];
}

export interface RecruitingCriteria {
  sport: string;
  gradYears: number[];
  positions: string[];
  includeSecondaryPosition: boolean;
  location: LocationCriterion;
  metrics: MetricCriterion[];
  uncommittedOnly: boolean;
  /** "include": prospects with missing data stay in results, flagged. "exclude": missing required data excludes them. */
  missingPolicy: "include" | "exclude";
}

export type CriterionStatus = "pass" | "fail" | "missing" | "unverified" | "conflict";

export interface CriterionResult {
  id: string;
  label: string;
  importance: Importance;
  status: CriterionStatus;
  detail: string;
  observationId?: string;
}

export interface MatchResult {
  athleteId: string;
  criteria: CriterionResult[];
  matched: number;
  total: number;
  failedRequired: number;
  missingRequired: number;
  eligible: boolean;
  summary: string; // e.g. "Matches 5 of your 6 criteria"
  distanceMi: number | null;
}

export interface AthleteCore {
  id: string;
  firstName: string;
  lastName: string;
  gradYear: number | null;
  sport: string;
  primaryPosition: string | null;
  secondaryPosition: string | null;
  highSchool: string | null;
  team: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  commitmentStatus: "uncommitted" | "committed" | "unknown";
  commitmentVerified: boolean;
  isDemo: boolean;
}
