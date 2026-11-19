// Registry of objective metrics RC understands. Adding a sport/metric is a
// matter of adding an entry here — no metric is ever derived or estimated.

export interface MetricDef {
  key: string;
  label: string;
  unit: string;
  /** Which direction is "better" — used only to phrase criteria, never to score athletes. */
  better: "higher" | "lower";
  /** Two observations differing by more than this are shown as a conflict. */
  conflictTolerance: number;
  format: (v: number) => string;
  /** Some data (GPA) is only lawful to hold with consent. */
  sensitive?: boolean;
}

export const METRICS: Record<string, MetricDef> = {
  height_in: {
    key: "height_in",
    label: "Height",
    unit: "in",
    better: "higher",
    conflictTolerance: 1,
    format: (v) => formatHeight(v),
  },
  weight_lb: {
    key: "weight_lb",
    label: "Weight",
    unit: "lb",
    better: "higher",
    conflictTolerance: 8,
    format: (v) => `${Math.round(v)} lb`,
  },
  exit_velo_mph: {
    key: "exit_velo_mph",
    label: "Exit velocity",
    unit: "mph",
    better: "higher",
    conflictTolerance: 2,
    format: (v) => `${v.toFixed(1).replace(/\.0$/, "")} mph`,
  },
  sixty_yd_sec: {
    key: "sixty_yd_sec",
    label: "60-yard dash",
    unit: "sec",
    better: "lower",
    conflictTolerance: 0.15,
    format: (v) => `${v.toFixed(2)} s`,
  },
  inf_velo_mph: {
    key: "inf_velo_mph",
    label: "Infield velocity",
    unit: "mph",
    better: "higher",
    conflictTolerance: 2,
    format: (v) => `${v.toFixed(1).replace(/\.0$/, "")} mph`,
  },
  of_velo_mph: {
    key: "of_velo_mph",
    label: "Outfield velocity",
    unit: "mph",
    better: "higher",
    conflictTolerance: 2,
    format: (v) => `${v.toFixed(1).replace(/\.0$/, "")} mph`,
  },
  fb_velo_mph: {
    key: "fb_velo_mph",
    label: "Fastball velocity",
    unit: "mph",
    better: "higher",
    conflictTolerance: 2,
    format: (v) => `${v.toFixed(1).replace(/\.0$/, "")} mph`,
  },
  pop_time_sec: {
    key: "pop_time_sec",
    label: "Pop time",
    unit: "sec",
    better: "lower",
    conflictTolerance: 0.08,
    format: (v) => `${v.toFixed(2)} s`,
  },
  gpa: {
    key: "gpa",
    label: "GPA",
    unit: "",
    better: "higher",
    conflictTolerance: 0.15,
    format: (v) => v.toFixed(2),
    sensitive: true,
  },
};

export const METRIC_KEYS = Object.keys(METRICS);

export function metricDef(key: string): MetricDef {
  return (
    METRICS[key] ?? {
      key,
      label: key,
      unit: "",
      better: "higher",
      conflictTolerance: 0,
      format: (v: number) => String(v),
    }
  );
}

export function formatHeight(inches: number): string {
  const ft = Math.floor(inches / 12);
  const rem = Math.round((inches - ft * 12) * 10) / 10;
  return `${ft}'${rem}"`;
}

/** Parses 5'10", 5’10”, 5-10, 5 ft 10 in, 70 (inches). Returns inches or null. */
export function parseHeight(input: string): number | null {
  const s = input.trim().replace(/[’‘`´]/g, "'").replace(/[”“″]/g, '"');
  let m = s.match(/^(\d)\s*(?:'|ft|feet|-)\s*(\d{1,2}(?:\.\d)?)?\s*(?:"|in|inches)?$/i);
  if (m) {
    const ft = Number(m[1]);
    const inch = m[2] ? Number(m[2]) : 0;
    if (inch >= 12) return null;
    return ft * 12 + inch;
  }
  m = s.match(/^(\d{2}(?:\.\d)?)\s*(?:"|in|inches)?$/i);
  if (m) {
    const v = Number(m[1]);
    return v >= 48 && v <= 90 ? v : null;
  }
  return null;
}

export const POSITIONS: Record<string, string> = {
  SS: "Shortstop",
  "2B": "Second base",
  "3B": "Third base",
  "1B": "First base",
  C: "Catcher",
  CF: "Center field",
  OF: "Outfield",
  LF: "Left field",
  RF: "Right field",
  RHP: "Right-handed pitcher",
  LHP: "Left-handed pitcher",
  UTIL: "Utility",
};

const POSITION_GROUPS: Record<string, string[]> = {
  OF: ["OF", "CF", "LF", "RF"],
  MIF: ["SS", "2B"],
  INF: ["SS", "2B", "3B", "1B"],
  P: ["RHP", "LHP"],
};

/** Does an athlete's listed position satisfy a wanted position (handles OF ⊇ CF etc.)? */
export function positionMatches(wanted: string, actual: string | null | undefined): boolean {
  if (!actual) return false;
  const w = wanted.toUpperCase();
  const a = actual.toUpperCase();
  if (w === a) return true;
  const group = POSITION_GROUPS[w];
  return group ? group.includes(a) : false;
}
