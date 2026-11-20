import type { SourceKind, Verification } from "../domain/types";

/** A normalized athlete record as delivered by any authorized source. */
export interface ProviderAthleteRecord {
  externalId?: string | null;
  firstName: string;
  lastName: string;
  gradYear: number | null;
  sport?: string;
  primaryPosition?: string | null;
  secondaryPosition?: string | null;
  bats?: string | null;
  throws?: string | null;
  highSchool?: string | null;
  team?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  email?: string | null;
  guardianEmail?: string | null;
  commitmentStatus?: "uncommitted" | "committed" | "unknown";
  commitmentVerified?: boolean;
  metrics?: Array<{ key: string; value: number; measuredAt: string | null; verification: Verification; sourceUrl?: string | null; eventName?: string | null }>;
  film?: Array<{ url: string; title?: string | null; recordedAt?: string | null }>;
  games?: ProviderGame[];
  /** Public stats pages to keep checking for season stats (e.g. a MaxPreps profile). */
  profileUrls?: string[];
}

export interface ProviderGame {
  externalId?: string | null;
  teamName?: string | null;
  opponent?: string | null;
  venue?: string | null;
  city?: string | null;
  state?: string | null;
  startsAt: string;
  status?: "scheduled" | "cancelled";
  participationConfirmed?: boolean;
  sourceUrl?: string | null;
}

export interface ProviderStatus {
  status: "connected" | "not_connected" | "error" | "import_only";
  detail: string;
}

export interface DataProvider {
  id: string;
  name: string;
  kind: SourceKind;
  description: string;
  /** Can RC pull updates on a schedule from this provider? */
  supportsSync: boolean;
  status(env: NodeJS.ProcessEnv, org: { isDemo: boolean }): ProviderStatus;
  sync?(ctx: { config: Record<string, unknown>; isDemo: boolean; now: Date }): Promise<{ records: ProviderAthleteRecord[]; config?: Record<string, unknown> }>;
}
