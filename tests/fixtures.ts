import type { AthleteCore, MetricObservation } from "@/lib/domain/types";

export function athlete(over: Partial<AthleteCore> = {}): AthleteCore {
  return {
    id: "a1", firstName: "Test", lastName: "Athlete", gradYear: 2027, sport: "baseball",
    primaryPosition: "SS", secondaryPosition: null, highSchool: "Test HS", team: null,
    city: "Austin", state: "TX", zip: "78701", lat: 30.2711, lng: -97.7437,
    commitmentStatus: "uncommitted", commitmentVerified: true, isDemo: true, ...over,
  };
}

let n = 0;
export function obs(over: Partial<MetricObservation> = {}): MetricObservation {
  n++;
  return {
    id: `o${n}`, athleteId: "a1", sourceId: "s1", sourceName: "Test Showcase", sourceKind: "import",
    metricKey: "exit_velo_mph", value: 92, unit: "mph", measuredAt: "2026-06-15", checkedAt: "2026-11-01T00:00:00Z",
    verification: "independently_verified", sourceUrl: null, ...over,
  };
}
