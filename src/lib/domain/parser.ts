// Deterministic parser for coach search requests such as:
//   "Find 2027 and 2028 shortstops within 150 miles of campus. Minimum 5'10",
//    175 pounds, 90 mph exit velocity. Show verified stats and film, monitor
//    their upcoming games, and prepare camp invitations for qualified prospects."
//
// It is rule-based on purpose: coaches can see exactly what RC understood,
// and anything it did not understand is reported back instead of guessed.

import { geocode, normalizeState, US_STATES } from "./geo";
import { parseHeight } from "./metrics";
import { defaultCriteria } from "./criteria";
import type { MetricCriterion, RecruitingCriteria } from "./types";

export interface ParsedRequest {
  criteria: RecruitingCriteria;
  actions: { monitorGames: boolean; prepareCampInvites: boolean; showFilm: boolean; saveMission: boolean };
  understood: string[];
  warnings: string[];
}

// Words are matched case-insensitively; abbreviations (SS, OF, C...) only in
// capitals so "within 50 miles of campus" never reads as "OF".
const POSITION_WORDS: Array<[RegExp, RegExp | null, string[]]> = [
  [/\bshort\s?stops?\b/i, /\bSS\b/, ["SS"]],
  [/\bsecond\s?base(?:men|man)?\b/i, /\b2B\b/, ["2B"]],
  [/\bthird\s?base(?:men|man)?\b/i, /\b3B\b/, ["3B"]],
  [/\bfirst\s?base(?:men|man)?\b/i, /\b1B\b/, ["1B"]],
  [/\bmiddle\s+infield(?:ers?)?\b/i, /\bMIF\b/, ["SS", "2B"]],
  [/\b(?<!middle\s)infield(?:ers)\b/i, /\bINF\b/, ["SS", "2B", "3B", "1B"]],
  [/\bcatch(?:er|ers)\b/i, /\bC\b(?=[\s,.]|$)/, ["C"]],
  [/\bcenter\s?field(?:ers?)?\b/i, /\bCF\b/, ["CF"]],
  [/\boutfield(?:ers?)?\b/i, /\bOFs?\b/, ["OF"]],
  [/\bright[-\s]handed\s+pitch(?:er|ers)\b/i, /\bRHPs?\b/, ["RHP"]],
  [/\bleft[-\s]handed\s+pitch(?:er|ers)\b/i, /\bLHPs?\b/, ["LHP"]],
];

export function parseRecruitingRequest(
  text: string,
  campus: { label: string; lat: number; lng: number } | null,
  sport = "baseball",
): ParsedRequest {
  const criteria = defaultCriteria(sport);
  const understood: string[] = [];
  const warnings: string[] = [];
  const t = text.replace(/[’‘]/g, "'").replace(/[”“]/g, '"');

  // Graduation years
  const years = Array.from(new Set((t.match(/\b20[2-4]\d\b/g) ?? []).map(Number))).sort();
  if (years.length) {
    criteria.gradYears = years;
    understood.push(`Graduation year: ${years.join(", ")}`);
  }

  // Positions — avoid matching "pitcher" twice when RHP/LHP present
  const positions = new Set<string>();
  for (const [word, abbr, pos] of POSITION_WORDS) if (word.test(t) || abbr?.test(t)) pos.forEach((p) => positions.add(p));
  if (/\bpitch(?:er|ers)\b/i.test(t) && !positions.has("RHP") && !positions.has("LHP")) {
    positions.add("RHP");
    positions.add("LHP");
  }
  if (positions.has("OF")) ["CF"].forEach((p) => positions.delete(p));
  if (positions.size) {
    criteria.positions = Array.from(positions);
    understood.push(`Position: ${criteria.positions.join(" / ")}`);
  }

  // Radius
  const radius = t.match(/within\s+(\d{1,4})\s*(?:mi|miles?)\b(?:\s+(?:of|from)\s+([^.;,]+?(?:,\s*[A-Z]{2}\b)?))?(?=[.;,]|\s+(?:minimum|min|at\s+least|with|who|and\s+(?:show|monitor|prepare))|$)/i);
  if (radius) {
    const miles = Number(radius[1]);
    const placeRaw = (radius[2] ?? "campus").trim().replace(/,$/, "");
    if (/^(?:our\s+)?campus$|^(?:our\s+)?school$|^here$/i.test(placeRaw)) {
      if (campus) {
        criteria.location = { mode: "radius", center: campus, radiusMi: miles };
        understood.push(`Within ${miles} miles of campus (${campus.label})`);
      } else {
        warnings.push("You asked for a radius from campus, but your campus location isn't set. Add it in Settings.");
      }
    } else {
      const g = geocode(placeRaw);
      if (g) {
        criteria.location = { mode: "radius", center: { label: g.label, lat: g.lat, lng: g.lng }, radiusMi: miles };
        understood.push(`Within ${miles} miles of ${g.label}`);
      } else {
        warnings.push(`Couldn't find the location "${placeRaw}". Try a ZIP code or "City, ST".`);
      }
    }
  } else if (/\bnationwide\b|\banywhere\b/i.test(t)) {
    criteria.location = { mode: "nationwide" };
    understood.push("Nationwide");
  } else {
    // States: "in Texas and Oklahoma", "from TX, OK"
    const stateHits = new Set<string>();
    const inClause = t.match(/\b(?:in|from)\s+((?:[A-Z][a-z]+(?:\s[A-Z][a-z]+)?|[A-Z]{2})(?:\s*(?:,|and|or|&)\s*(?:[A-Z][a-z]+(?:\s[A-Z][a-z]+)?|[A-Z]{2}))*)/);
    if (inClause) {
      for (const part of inClause[1].split(/\s*(?:,|\band\b|\bor\b|&)\s*/)) {
        const st = normalizeState(part);
        if (st) stateHits.add(st);
      }
    }
    if (stateHits.size) {
      criteria.location = { mode: "states", states: Array.from(stateHits) };
      understood.push(`State: ${Array.from(stateHits).map((s) => US_STATES[s]).join(", ")}`);
    }
  }

  const metrics: MetricCriterion[] = [];
  const verifiedOnly = /\bverified\s+(?:only|stats|data|metrics|numbers)\b|\bonly\s+verified\b/i.test(t);

  // Height: "minimum 5'10"", "at least 6'0", "5'10"+"
  const height = t.match(/(?:min(?:imum)?|at\s+least|over)?\s*(\d)\s*'\s*(\d{1,2})"?\s*(?:\+|or taller)?/);
  if (height) {
    const inches = parseHeight(`${height[1]}'${height[2]}"`);
    if (inches) {
      metrics.push({ key: "height_in", op: "gte", value: inches, importance: "required", verifiedOnly });
      understood.push(`Height ≥ ${height[1]}'${height[2]}"`);
    }
  }

  // Weight
  const weight = t.match(/(\d{3})\s*(?:lbs?|pounds)\b/i);
  if (weight) {
    metrics.push({ key: "weight_lb", op: "gte", value: Number(weight[1]), importance: "required", verifiedOnly });
    understood.push(`Weight ≥ ${weight[1]} lb`);
  }

  // Exit velocity: "90 mph exit velocity", "exit velo 90+", "90+ EV"
  const ev =
    t.match(/(\d{2,3}(?:\.\d)?)\s*\+?\s*(?:mph)?\s*(?:exit\s*velo(?:city)?|EV)\b/i) ??
    t.match(/exit\s*velo(?:city)?\s*(?:of|:)?\s*(?:at\s+least\s+)?(\d{2,3}(?:\.\d)?)/i);
  if (ev) {
    metrics.push({ key: "exit_velo_mph", op: "gte", value: Number(ev[1]), importance: "required", verifiedOnly });
    understood.push(`Exit velocity ≥ ${ev[1]} mph`);
  }

  // Fastball velocity
  const fb =
    t.match(/(\d{2,3})\s*\+?\s*(?:mph)?\s*(?:fastball|FB)\b/i) ?? t.match(/(?:fastball|FB)\s*(?:velo(?:city)?)?\s*(?:of|:)?\s*(\d{2,3})/i);
  if (fb) {
    metrics.push({ key: "fb_velo_mph", op: "gte", value: Number(fb[1]), importance: "required", verifiedOnly });
    understood.push(`Fastball velocity ≥ ${fb[1]} mph`);
  }

  // Infield velocity
  const inf = t.match(/(\d{2,3})\s*\+?\s*(?:mph)?\s*(?:infield|INF)\s*velo/i);
  if (inf) {
    metrics.push({ key: "inf_velo_mph", op: "gte", value: Number(inf[1]), importance: "required", verifiedOnly });
    understood.push(`Infield velocity ≥ ${inf[1]} mph`);
  }

  // 60-yard dash: "60 under 7.0", "sub-7.0 60", "60-yard dash under 7.0 seconds"
  const sixty =
    t.match(/60(?:[-\s]?(?:yard|yd))?(?:\s*dash)?\s*(?:time\s*)?(?:under|below|of|<)\s*(\d\.\d{1,2})/i) ??
    t.match(/sub[-\s]?(\d\.\d{1,2})\s*60/i);
  if (sixty) {
    metrics.push({ key: "sixty_yd_sec", op: "lte", value: Number(sixty[1]), importance: "required", verifiedOnly });
    understood.push(`60-yard dash ≤ ${sixty[1]} s`);
  }

  // Pop time
  const pop = t.match(/pop\s*time\s*(?:under|below|of|<)\s*(\d\.\d{1,2})/i);
  if (pop) {
    metrics.push({ key: "pop_time_sec", op: "lte", value: Number(pop[1]), importance: "required", verifiedOnly });
    understood.push(`Pop time ≤ ${pop[1]} s`);
  }

  // GPA
  const gpa = t.match(/(\d\.\d{1,2})\s*\+?\s*GPA|GPA\s*(?:of|:|above|over)?\s*(\d\.\d{1,2})/i);
  if (gpa) {
    const v = Number(gpa[1] ?? gpa[2]);
    metrics.push({ key: "gpa", op: "gte", value: v, importance: "preferred", verifiedOnly: false });
    understood.push(`GPA ≥ ${v} (preferred; only when lawfully available)`);
  }

  criteria.metrics = metrics;
  if (verifiedOnly) understood.push("Verified data only for measurable standards");

  if (/\buncommitted\b/i.test(t)) {
    criteria.uncommittedOnly = true;
    understood.push("Verified uncommitted only");
  }
  if (/\b(?:exclude|skip|hide)\b[^.]*\bmissing\b/i.test(t)) {
    criteria.missingPolicy = "exclude";
    understood.push("Exclude prospects with missing required data");
  }

  const actions = {
    monitorGames: /\b(?:monitor|track|follow)\b[^.]*\b(?:games?|schedules?)\b/i.test(t),
    prepareCampInvites: /\bcamp\b[^.]*\binvit/i.test(t) || /\binvit\w*\b[^.]*\bcamp\b/i.test(t),
    showFilm: /\bfilm\b|\bvideo\b/i.test(t),
    saveMission: /\b(?:monitor|track|keep\s+(?:looking|searching)|every\s+(?:day|week)|daily|weekly|recurring)\b/i.test(t),
  };
  if (actions.monitorGames) understood.push("Monitor upcoming games for matching athletes");
  if (actions.prepareCampInvites) understood.push("Prepare camp invitation drafts for qualified prospects (sent only after your approval)");
  if (actions.saveMission) understood.push("Save as a recurring discovery mission");

  if (understood.length === 0) warnings.push("RC didn't recognize any recruiting standards in that request.");

  return { criteria, actions, understood, warnings };
}
