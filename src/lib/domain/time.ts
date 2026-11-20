// Local time for a program. Game times on schedule pages are written in local
// time ("4:00 PM"), and coaches read times in their own zone, so RC converts
// using the program's time zone (derived from campus, editable in Settings).

export function timezoneForLocation(lat: number | null | undefined, lng: number | null | undefined, state?: string | null): string {
  if (state === "AZ") return "America/Phoenix";
  if (state === "HI") return "Pacific/Honolulu";
  if (state === "AK") return "America/Anchorage";
  if (lng == null) return "America/Chicago";
  if (lng < -114.5) return "America/Los_Angeles";
  if (lng < -101.5) return "America/Denver";
  if (lng < -86.5) return "America/Chicago";
  return "America/New_York";
}

/** Offset (minutes) of a zone from UTC at a given instant. */
function offsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** Converts a wall-clock time in `tz` to a UTC ISO string. */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): string {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const off = offsetMinutes(tz, guess);
  const first = new Date(guess.getTime() - off * 60000);
  const off2 = offsetMinutes(tz, first); // handle DST boundary
  return new Date(guess.getTime() - off2 * 60000).toISOString();
}

export function formatInZone(iso: string, tz: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleString("en-US", { timeZone: tz, ...opts });
}

export function tzAbbrev(tz: string, at = new Date()): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "";
}
