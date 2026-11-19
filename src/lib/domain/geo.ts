// Geographic search. Coordinates come from the US ZIP code centroid dataset
// bundled with the `zipcodes` package (offline, no external calls), so every
// distance RC shows is computed from a real geocoded point. Precision is
// recorded so the UI can say "distance from ZIP centroid" honestly.

import zipcodes from "zipcodes";

export interface GeoPoint {
  lat: number;
  lng: number;
  label: string;
  precision: "zip" | "city" | "coordinates";
}

export const RADIUS_PRESETS = [25, 50, 75, 100, 150, 250, 500];

const EARTH_RADIUS_MI = 3958.7613;

export function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts",
  MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

const STATE_BY_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATES).map(([abbr, name]) => [name.toLowerCase(), abbr]),
);

export function normalizeState(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim();
  if (s.length === 2 && US_STATES[s.toUpperCase()]) return s.toUpperCase();
  return STATE_BY_NAME[s.toLowerCase()] ?? null;
}

export function geocodeZip(zip: string): GeoPoint | null {
  const z = zip.trim().slice(0, 5);
  if (!/^\d{5}$/.test(z)) return null;
  const hit = zipcodes.lookup(z);
  if (!hit || hit.country !== "US") return null;
  return { lat: hit.latitude, lng: hit.longitude, label: `${hit.city}, ${hit.state} ${hit.zip}`, precision: "zip" };
}

export function geocodeCity(city: string, state: string): GeoPoint | null {
  const st = normalizeState(state);
  if (!st || !city.trim()) return null;
  const hits = zipcodes.lookupByName(city.trim(), st);
  if (!hits || hits.length === 0) return null;
  // Average the ZIP centroids in the city for a stable city-level point.
  const lat = hits.reduce((s, h) => s + h.latitude, 0) / hits.length;
  const lng = hits.reduce((s, h) => s + h.longitude, 0) / hits.length;
  return { lat, lng, label: `${hits[0].city}, ${st}`, precision: "city" };
}

/**
 * Geocode free text: "78712", "Austin, TX", "Austin TX", "30.28,-97.73".
 * Returns null rather than guessing when the place can't be resolved.
 */
export function geocode(input: string): GeoPoint | null {
  const s = input.trim();
  if (!s) return null;
  const coords = s.match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (coords) {
    const lat = Number(coords[1]);
    const lng = Number(coords[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng, label: s, precision: "coordinates" };
  }
  const zip = s.match(/\b(\d{5})(?:-\d{4})?\b/);
  if (zip) {
    const g = geocodeZip(zip[1]);
    if (g) return g;
  }
  const cityState = s.match(/^(.+?)[,\s]+([A-Za-z]{2}|[A-Za-z ]{4,})$/);
  if (cityState) {
    // Try "City, ST" and also "City, Statename"
    const g = geocodeCity(cityState[1].replace(/,$/, ""), cityState[2]);
    if (g) return g;
  }
  return null;
}

/** Best available point for an athlete record. */
export function locateAthlete(a: {
  zip?: string | null;
  city?: string | null;
  state?: string | null;
}): GeoPoint | null {
  if (a.zip) {
    const g = geocodeZip(a.zip);
    if (g) return g;
  }
  if (a.city && a.state) return geocodeCity(a.city, a.state);
  return null;
}
