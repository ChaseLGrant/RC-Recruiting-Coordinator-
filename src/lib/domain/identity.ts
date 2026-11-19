// Identity matching & duplicate detection. Records from different sources are
// merged only when the evidence is strong; borderline cases go to the coach
// as a "possible duplicate" approval instead of being merged silently.

export interface IdentityInput {
  firstName: string;
  lastName: string;
  gradYear: number | null;
  highSchool?: string | null;
  city?: string | null;
  state?: string | null;
  email?: string | null;
}

export interface IdentityMatch<T> {
  candidate: T;
  score: number; // 0..1
  reasons: string[];
}

const NICKNAMES: Record<string, string> = {
  alex: "alexander", andy: "andrew", drew: "andrew", ben: "benjamin", bill: "william", billy: "william",
  will: "william", liam: "william", bob: "robert", rob: "robert", bobby: "robert", chris: "christopher",
  dan: "daniel", danny: "daniel", dave: "david", jake: "jacob", jim: "james", jimmy: "james", jon: "jonathan",
  joe: "joseph", joey: "joseph", josh: "joshua", matt: "matthew", mike: "michael", nate: "nathan",
  nick: "nicholas", pat: "patrick", sam: "samuel", steve: "steven", tom: "thomas", tommy: "thomas",
  tony: "anthony", zach: "zachary", zack: "zachary", max: "maxwell", gabe: "gabriel", cam: "cameron",
  jt: "jt", aj: "aj", cj: "cj",
};

export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "")
    .replace(/[^a-z]/g, "");
}

export function canonicalFirst(s: string): string {
  const n = normalizeName(s);
  return NICKNAMES[n] ?? n;
}

export function normalizeSchool(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/\b(high school|hs|h\.s\.|academy|school|the|prep|preparatory)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function scoreIdentity(a: IdentityInput, b: IdentityInput): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) {
    return { score: 1, reasons: ["Same email address"] };
  }
  if (normalizeName(a.lastName) !== normalizeName(b.lastName)) return { score: 0, reasons: ["Different last name"] };
  let score = 0.35;
  reasons.push("Same last name");

  const fa = canonicalFirst(a.firstName);
  const fb = canonicalFirst(b.firstName);
  if (fa === fb) {
    score += 0.25;
    reasons.push(normalizeName(a.firstName) === normalizeName(b.firstName) ? "Same first name" : "First name matches as nickname");
  } else if (fa[0] === fb[0] && (fa.startsWith(fb) || fb.startsWith(fa))) {
    score += 0.12;
    reasons.push("Similar first name");
  } else {
    return { score: 0.1, reasons: ["Different first name"] };
  }

  if (a.gradYear && b.gradYear) {
    if (a.gradYear === b.gradYear) {
      score += 0.2;
      reasons.push("Same graduation year");
    } else {
      score -= 0.3;
      reasons.push("Different graduation year");
    }
  }
  if (a.state && b.state) {
    if (a.state.toUpperCase() === b.state.toUpperCase()) {
      score += 0.08;
      reasons.push("Same state");
    } else {
      score -= 0.25;
      reasons.push("Different state");
    }
  }
  const sa = normalizeSchool(a.highSchool);
  const sb = normalizeSchool(b.highSchool);
  if (sa && sb) {
    if (sa === sb) {
      score += 0.15;
      reasons.push("Same high school");
    } else {
      score -= 0.1;
      reasons.push("Different high school listed");
    }
  } else if (a.city && b.city && a.city.toLowerCase() === b.city.toLowerCase()) {
    score += 0.05;
    reasons.push("Same city");
  }
  return { score: Math.max(0, Math.min(1, score)), reasons };
}

export const AUTO_MERGE_THRESHOLD = 0.85;
export const REVIEW_THRESHOLD = 0.6;

export function findIdentityMatches<T extends IdentityInput>(input: IdentityInput, candidates: T[]): IdentityMatch<T>[] {
  return candidates
    .map((c) => {
      const { score, reasons } = scoreIdentity(input, c);
      return { candidate: c, score, reasons };
    })
    .filter((m) => m.score >= REVIEW_THRESHOLD)
    .sort((x, y) => y.score - x.score);
}

export type IdentityDecision<T> =
  | { kind: "merge"; match: IdentityMatch<T> }
  | { kind: "review"; matches: IdentityMatch<T>[] }
  | { kind: "new" };

export function decideIdentity<T extends IdentityInput>(input: IdentityInput, candidates: T[]): IdentityDecision<T> {
  const matches = findIdentityMatches(input, candidates);
  if (matches.length === 0) return { kind: "new" };
  const top = matches[0];
  const runnerUp = matches[1];
  // Only auto-merge when the top match is strong AND unambiguous.
  if (top.score >= AUTO_MERGE_THRESHOLD && (!runnerUp || runnerUp.score < AUTO_MERGE_THRESHOLD)) {
    return { kind: "merge", match: top };
  }
  return { kind: "review", matches };
}

export function identityConfidenceLabel(score: number): "high" | "medium" | "low" {
  if (score >= AUTO_MERGE_THRESHOLD) return "high";
  if (score >= REVIEW_THRESHOLD) return "medium";
  return "low";
}
