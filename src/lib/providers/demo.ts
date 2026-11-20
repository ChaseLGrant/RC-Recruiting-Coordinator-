// DEMO DATA ONLY. Every athlete produced here is fictional and is only ever
// loaded into a workspace flagged is_demo. The UI labels it "DEMO" everywhere.
// Two demo sources exist so the demo can show cross-source identity matching
// and conflicting measurements, exactly as real sources would.

import zipcodes from "zipcodes";
import type { DataProvider, ProviderAthleteRecord } from "./types";

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Mason", "Ethan", "Caleb", "Lucas", "Owen", "Wyatt", "Jackson", "Carter", "Diego", "Mateo", "Isaiah", "Grant", "Tyler", "Brody", "Cole", "Easton", "Hudson", "Rowan", "Nolan", "Gavin", "Micah", "Landon", "Reid", "Tate", "Jace", "Michael", "Nicholas", "Andrew", "Zachary", "Samuel"];
const LAST = ["Alvarez", "Bennett", "Calloway", "Dunham", "Estrada", "Fowler", "Garrity", "Holloway", "Ibarra", "Jessup", "Kincaid", "Lockhart", "Mercado", "Navarro", "Okafor", "Pruitt", "Quintero", "Ramsey", "Sandoval", "Talbot", "Underwood", "Vance", "Whitfield", "Yates", "Zamora", "Brandt", "Castillo", "Delgado", "Ellison", "Fairchild"];
// Real towns near the program's campus (real ZIP centroids, so distances are
// real); every school and player attached to them is fictional.
const DEFAULT_TOWNS: Array<[string, string, string]> = [
  ["Austin", "TX", "78745"], ["Round Rock", "TX", "78664"], ["San Marcos", "TX", "78666"], ["Georgetown", "TX", "78626"],
  ["Waco", "TX", "76710"], ["San Antonio", "TX", "78209"], ["New Braunfels", "TX", "78130"], ["Temple", "TX", "76502"],
  ["Houston", "TX", "77005"], ["Katy", "TX", "77494"], ["College Station", "TX", "77840"], ["Dallas", "TX", "75214"],
  ["Fort Worth", "TX", "76107"], ["Lubbock", "TX", "79424"], ["El Paso", "TX", "79912"], ["Corpus Christi", "TX", "78412"],
  ["Tulsa", "OK", "74105"], ["Norman", "OK", "73072"], ["Shreveport", "LA", "71106"], ["Baton Rouge", "LA", "70808"],
];

const townCache = new Map<string, Array<[string, string, string]>>();
export function townsNear(campusZip: string | undefined): Array<[string, string, string]> {
  if (!campusZip || campusZip === "78712") return DEFAULT_TOWNS;
  const hit = townCache.get(campusZip);
  if (hit) return hit;
  const pick = (miles: number) => {
    const seen = new Map<string, [string, string, string]>();
    for (const z of zipcodes.radius(campusZip, miles).sort()) {
      const info = zipcodes.lookup(z);
      if (!info || info.country !== "US") continue;
      const key = `${info.city}|${info.state}`;
      if (!seen.has(key)) seen.set(key, [info.city, info.state, info.zip]);
    }
    return Array.from(seen.values());
  };
  // ~16 towns within 60 miles plus a few farther out, so radius searches have real edges.
  const near = pick(60);
  const far = pick(220).filter((t) => !near.some((n) => n[0] === t[0]));
  const r = rng(campusZip.split("").reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const shuffle = <T,>(arr: T[]) => arr.map((v) => [r(), v] as const).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
  const towns = [...shuffle(near).slice(0, 16), ...shuffle(far).slice(0, 4)];
  const out = towns.length >= 8 ? towns : DEFAULT_TOWNS;
  townCache.set(campusZip, out);
  return out;
}

const MASCOTS = ["Ridge", "Creek", "Valley", "Lakeview", "Pinecrest", "Oak Hollow", "Stonebridge", "Mesa", "Prairie", "Cedar Park"];
const POS: Array<[string, string | null]> = [["SS", "2B"], ["SS", null], ["SS", "3B"], ["SS", "CF"], ["2B", "SS"], ["C", "1B"], ["CF", "OF"], ["RHP", "SS"], ["3B", "1B"], ["LHP", "OF"], ["SS", "RHP"]];

interface DemoAthlete {
  ext: string; first: string; nick: string; last: string; grad: number; pos: [string, string | null];
  town: [string, string, string]; school: string; heightIn: number; weightLb: number; ev: number; sixty: number;
  inf: number; gpa: number | null; committed: "uncommitted" | "committed" | "unknown"; commitVerified: boolean; hasFilm: boolean;
}

function roster(campusZip?: string): DemoAthlete[] {
  const TOWNS = townsNear(campusZip);
  const r = rng(20261119);
  const out: DemoAthlete[] = [];
  for (let i = 0; i < 140; i++) {
    const first = FIRST[Math.floor(r() * FIRST.length)];
    const nick = first === "Michael" ? "Mike" : first === "Nicholas" ? "Nick" : first === "Andrew" ? "Drew" : first === "Zachary" ? "Zach" : first === "Samuel" ? "Sam" : first;
    const town = TOWNS[Math.floor(r() * TOWNS.length)];
    out.push({
      ext: `demo-${1000 + i}`,
      first, nick, last: LAST[Math.floor(r() * LAST.length)],
      grad: 2026 + Math.floor(r() * 4),
      pos: POS[Math.floor(r() * POS.length)],
      town,
      school: `${MASCOTS[Math.floor(r() * MASCOTS.length)]} ${town[0]} High School (fictional)`,
      heightIn: 67 + Math.floor(r() * 9),
      weightLb: 155 + Math.floor(r() * 50),
      ev: Math.round((82 + r() * 14) * 10) / 10,
      sixty: Math.round((6.6 + r() * 0.8) * 100) / 100,
      inf: Math.round((78 + r() * 12) * 10) / 10,
      gpa: r() > 0.4 ? Math.round((2.7 + r() * 1.3) * 100) / 100 : null,
      committed: r() > 0.85 ? "committed" : r() > 0.2 ? "uncommitted" : "unknown",
      commitVerified: r() > 0.3,
      hasFilm: r() > 0.25,
    });
  }
  return out;
}

const rosterCache = new Map<string, DemoAthlete[]>();
function rosterFor(campusZip?: string) {
  const k = campusZip ?? "default";
  if (!rosterCache.has(k)) rosterCache.set(k, roster(campusZip));
  return rosterCache.get(k)!;
}

function isoDaysFrom(anchor: Date, days: number, hour: number) {
  const d = new Date(anchor);
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

export const DEMO_SHOWCASE: DataProvider = {
  id: "demo_showcase",
  name: "Demo Showcase Dataset (fictional)",
  kind: "demo",
  description: "Fictional showcase measurables for the demonstration workspace only.",
  supportsSync: true,
  status: (_env, org) =>
    org.isDemo ? { status: "connected", detail: "Demonstration data — all athletes are fictional." } : { status: "not_connected", detail: "Available in demo workspaces only." },
  async sync({ config, isDemo }) {
    if (!isDemo) throw new Error("Demo data can only be loaded into a demo workspace.");
    const syncCount = Number(config.syncCount ?? 0) + 1;
    // First sync: 120 athletes. Later syncs: 20 more appear and some re-test.
    const visible = rosterFor(config.campusZip as string | undefined).slice(0, syncCount === 1 ? 120 : 140);
    const records: ProviderAthleteRecord[] = visible.map((a, i) => {
      const retest = syncCount > 1 && i % 6 === 0;
      const metrics: NonNullable<ProviderAthleteRecord["metrics"]> = [
        { key: "height_in", value: a.heightIn, measuredAt: "2026-06-14", verification: "independently_verified", eventName: "Demo Summer Showcase" },
        { key: "weight_lb", value: a.weightLb, measuredAt: "2026-06-14", verification: "independently_verified", eventName: "Demo Summer Showcase" },
        { key: "exit_velo_mph", value: a.ev, measuredAt: "2026-06-14", verification: "independently_verified", eventName: "Demo Summer Showcase" },
        { key: "inf_velo_mph", value: a.inf, measuredAt: "2026-06-14", verification: "independently_verified", eventName: "Demo Summer Showcase" },
      ];
      if (i % 3 !== 0) metrics.push({ key: "sixty_yd_sec", value: a.sixty, measuredAt: "2026-06-14", verification: "independently_verified", eventName: "Demo Summer Showcase" });
      if (retest) metrics.push({ key: "exit_velo_mph", value: Math.round((a.ev + 2.4) * 10) / 10, measuredAt: "2026-11-08", verification: "independently_verified", eventName: "Demo Fall Classic" });
      return {
        externalId: a.ext, firstName: a.first, lastName: a.last, gradYear: a.grad, sport: "baseball",
        primaryPosition: a.pos[0], secondaryPosition: a.pos[1], highSchool: a.school,
        city: a.town[0], state: a.town[1], zip: a.town[2],
        commitmentStatus: a.committed, commitmentVerified: a.commitVerified,
        email: `${a.first.toLowerCase()}.${a.last.toLowerCase()}@example.com`,
        metrics,
        film: a.hasFilm ? [{ url: `https://example.com/demo-film/${a.ext}`, title: "Showcase skills video (demo placeholder link)", recordedAt: "2026-06-14" }] : [],
      };
    });
    return { records, config: { ...config, syncCount } };
  },
};

export const DEMO_TEAM_FEED: DataProvider = {
  id: "demo_team_feed",
  name: "Demo Team Schedule Feed (fictional)",
  kind: "demo",
  description: "Fictional team schedules plus family-reported sizes, for the demonstration workspace only.",
  supportsSync: true,
  status: (_env, org) =>
    org.isDemo ? { status: "connected", detail: "Demonstration data — all athletes are fictional." } : { status: "not_connected", detail: "Available in demo workspaces only." },
  async sync({ config, isDemo, now }) {
    if (!isDemo) throw new Error("Demo data can only be loaded into a demo workspace.");
    const syncCount = Number(config.syncCount ?? 0) + 1;
    // Anchor schedule dates on first sync so re-syncs don't look like changes.
    const anchor = new Date(String(config.anchor ?? now.toISOString()));
    const r = rng(77);
    const TOWNS = townsNear(config.campusZip as string | undefined);
    const records: ProviderAthleteRecord[] = rosterFor(config.campusZip as string | undefined).slice(0, 130).map((a, i) => {
      const games = [] as NonNullable<ProviderAthleteRecord["games"]>;
      const n = i % 4 === 3 ? 0 : 1 + (i % 3);
      for (let g = 0; g < n; g++) {
        let day = 2 + g * 6 + (i % 5);
        // On the second sync, one game per few athletes moves (a real "schedule change").
        if (syncCount > 1 && g === 0 && i % 7 === 0) day += 1;
        const opp = TOWNS[(i + g + 3) % TOWNS.length];
        games.push({
          externalId: `${a.ext}-g${g}`,
          teamName: `${a.school.replace(" High School (fictional)", "")} (fictional)`,
          opponent: `${MASCOTS[(i + g) % MASCOTS.length]} ${opp[0]} (fictional)`,
          venue: g % 2 === 0 ? "Home field" : `${opp[0]} field`,
          city: g % 2 === 0 ? a.town[0] : opp[0],
          state: g % 2 === 0 ? a.town[1] : opp[1],
          startsAt: isoDaysFrom(anchor, day, 23),
          participationConfirmed: false,
        });
      }
      // Family-reported size: sometimes differs from the showcase (a real-world conflict).
      const heightDelta = i % 5 === 0 ? 2 : 0;
      const weightDelta = i % 4 === 0 ? 12 : Math.round(r() * 4);
      return {
        externalId: `team-${a.ext}`,
        firstName: a.nick, lastName: a.last, gradYear: a.grad, sport: "baseball",
        primaryPosition: a.pos[0], highSchool: a.school.replace(" High School", " HS"), city: a.town[0], state: a.town[1],
        team: `${a.school.replace(" High School (fictional)", "")} (fictional)`,
        metrics: [
          { key: "height_in", value: a.heightIn + heightDelta, measuredAt: "2026-09-01", verification: "self_reported" },
          { key: "weight_lb", value: a.weightLb + weightDelta, measuredAt: "2026-09-01", verification: "self_reported" },
          ...(a.gpa != null ? [{ key: "gpa", value: a.gpa, measuredAt: "2026-08-15", verification: "self_reported" as const }] : []),
        ],
        games,
      };
    });
    return { records, config: { ...config, syncCount, anchor: anchor.toISOString() } };
  },
};
