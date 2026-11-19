// Time-savings estimates. Counts are REAL (from the event log); the minutes
// per task are coach-configurable ASSUMPTIONS and labeled as estimates.

export const EVENT_TYPES = {
  source_checked: "Sources checked",
  athlete_researched: "Athlete profiles researched",
  athlete_discovered: "New prospect matches",
  metric_updated: "Metrics updated",
  metric_verified: "Verified metrics recorded",
  game_identified: "Games identified",
  schedule_changed: "Schedule changes detected",
  draft_prepared: "Outreach drafts prepared",
  task_created: "Follow-up tasks organized",
  coach_action: "Coach decisions recorded",
  conflict_detected: "Data conflicts flagged",
  job_failed: "Background jobs failed",
  import_completed: "Data imports completed",
} as const;

export type EventType = keyof typeof EVENT_TYPES;

export const DEFAULT_MINUTES_PER_TASK: Partial<Record<EventType, number>> = {
  source_checked: 4,
  athlete_researched: 6,
  athlete_discovered: 10,
  metric_updated: 2,
  metric_verified: 2,
  game_identified: 5,
  schedule_changed: 3,
  draft_prepared: 8,
  task_created: 2,
  conflict_detected: 4,
};

export interface SavingsLine {
  type: EventType;
  label: string;
  count: number;
  minutesEach: number;
  minutes: number;
}

export function estimateSavings(
  counts: Partial<Record<EventType, number>>,
  minutesPerTask: Partial<Record<EventType, number>> = DEFAULT_MINUTES_PER_TASK,
): { lines: SavingsLine[]; totalMinutes: number } {
  const lines: SavingsLine[] = [];
  for (const [type, minutesEach] of Object.entries(minutesPerTask) as [EventType, number][]) {
    const count = counts[type] ?? 0;
    lines.push({ type, label: EVENT_TYPES[type], count, minutesEach, minutes: count * minutesEach });
  }
  return { lines, totalMinutes: lines.reduce((s, l) => s + l.minutes, 0) };
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} hr ${m} min` : `${h} hr`;
}
