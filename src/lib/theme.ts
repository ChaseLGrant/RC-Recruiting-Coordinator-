// Program theme tokens. A school gives RC two or three colors (and maybe a
// logo); RC derives every color the interface needs from them, picks a
// readable text color for each surface (WCAG contrast), and hands the result
// to CSS as variables. Every screen reads these variables, so one change in
// Settings → Branding (or the demo form) re-skins the whole app.

export interface ThemeInput {
  primary: string; // main team color: buttons, active states, rules
  accent?: string | null; // secondary team color: highlights, badges
  ink?: string | null; // dark surface (header, hero). Derived when missing.
}

export interface ThemeTokens {
  primary: string;
  onPrimary: string; // text on primary
  primaryText: string; // primary used as text/links on white (darkened until readable)
  ink: string; // dark surface
  onInk: string;
  accent: string;
  onAccent: string; // text on accent
  accentOnInk: string; // accent used as text on the dark surface (lightened until readable)
  primaryOnInk: string; // primary used as a rule/fill on the dark surface (lightened if invisible)
  mark: string; // fill for the team monogram / action buttons on the dark surface
  onMark: string;
}

const HEX6 = /^#[0-9a-f]{6}$/i;
const HEX3 = /^#[0-9a-f]{3}$/i;

export const WHITE = "#ffffff";
export const NEAR_BLACK = "#0b0d10";

/** "#abc" / "ABCDEF" / "#AbCdEf" → "#aabbcc"; anything else → null. */
export function normalizeHex(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = String(input).trim();
  if (!s.startsWith("#")) s = `#${s}`;
  if (HEX3.test(s)) s = `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return HEX6.test(s) ? s.toLowerCase() : null;
}

function rgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex) ?? "#000000";
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

function toHex([r, g, b]: [number, number, number]): string {
  const c = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colors (1–21). */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** Mix `hex` toward `target` by `t` (0–1). */
export function mix(hex: string, target: string, t: number): string {
  const a = rgb(hex);
  const b = rgb(target);
  return toHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

/** White or near-black, whichever reads better on `bg`. */
export function readableOn(bg: string): string {
  return contrast(WHITE, bg) >= contrast(NEAR_BLACK, bg) ? WHITE : NEAR_BLACK;
}

/** Push `fg` toward white or black (whichever direction helps) until it reaches `min` contrast on `bg`. */
export function ensureContrast(fg: string, bg: string, min: number): string {
  if (contrast(fg, bg) >= min) return fg;
  const toward = luminance(bg) > 0.4 ? "#000000" : WHITE;
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const c = mix(fg, toward, t);
    if (contrast(c, bg) >= min) return c;
  }
  return readableOn(bg);
}

/** A dark surface in the team's family: the given ink, a dark secondary, or the primary pushed toward black. */
export function deriveInk(primary: string, accent?: string | null): string {
  if (accent && luminance(accent) < 0.03) return accent;
  if (luminance(primary) < 0.025) return primary;
  return mix(primary, "#05070a", 0.78);
}

export function deriveTheme(input: ThemeInput): ThemeTokens {
  const primary = normalizeHex(input.primary) ?? "#1f3a68";
  const accent = normalizeHex(input.accent) ?? mix(primary, WHITE, 0.55);
  let ink = normalizeHex(input.ink) ?? deriveInk(primary, accent);
  // The dark surface must actually be dark, or white header text disappears.
  if (contrast(WHITE, ink) < 7) ink = mix(ink, "#05070a", 0.6);
  // On the dark header, a near-black primary disappears; use the secondary color instead.
  const mark = contrast(primary, ink) >= 1.6 ? primary : contrast(accent, ink) >= 1.6 ? accent : ensureContrast(primary, ink, 1.6);
  return {
    mark,
    onMark: readableOn(mark),
    primary,
    onPrimary: readableOn(primary),
    primaryText: ensureContrast(primary, WHITE, 4.5),
    ink,
    onInk: WHITE,
    accent,
    onAccent: readableOn(accent),
    accentOnInk: ensureContrast(accent, ink, 4.5),
    primaryOnInk: ensureContrast(primary, ink, 1.6),
  };
}

/** The CSS variables every RC screen reads. */
export function themeVars(t: ThemeTokens): Record<string, string> {
  return {
    "--team-primary": t.primary,
    "--team-on-primary": t.onPrimary,
    "--team-primary-text": t.primaryText,
    "--team-ink": t.ink,
    "--team-on-ink": t.onInk,
    "--team-accent": t.accent,
    "--team-on-accent": t.onAccent,
    "--team-accent-on-ink": t.accentOnInk,
    "--team-primary-on-ink": t.primaryOnInk,
    "--team-mark": t.mark,
    "--team-on-mark": t.onMark,
  };
}

/** Color pairs a coach can pick from in the demo form (generic combos, no school marks). */
export const COLOR_PRESETS: Array<{ id: string; label: string; primary: string; accent: string }> = [
  { id: "navy-gold", label: "Navy & Gold", primary: "#0c2340", accent: "#c99700" },
  { id: "red-black", label: "Red & Black", primary: "#c8102e", accent: "#111111" },
  { id: "royal-white", label: "Royal & White", primary: "#0033a0", accent: "#ffffff" },
  { id: "green-gold", label: "Green & Gold", primary: "#154734", accent: "#ffb81c" },
  { id: "maroon-white", label: "Maroon & White", primary: "#6d1e2c", accent: "#e8e3d9" },
  { id: "orange-navy", label: "Orange & Navy", primary: "#e35205", accent: "#13294b" },
  { id: "purple-gold", label: "Purple & Gold", primary: "#4b2e83", accent: "#d4b36a" },
  { id: "black-gold", label: "Black & Gold", primary: "#111111", accent: "#cfb53b" },
  { id: "cardinal-gold", label: "Cardinal & Gold", primary: "#8c1515", accent: "#d6a73a" },
  { id: "kelly-white", label: "Kelly Green & White", primary: "#00843d", accent: "#f2f2f2" },
  { id: "columbia-navy", label: "Columbia Blue & Navy", primary: "#4b9cd3", accent: "#13294b" },
  { id: "crimson-gray", label: "Crimson & Gray", primary: "#9e1b32", accent: "#828a8f" },
];

/** CSS variables for a program's saved branding (primary / accent / ink). */
export function brandingVars(b: { primary: string; accent: string; ink: string }): Record<string, string> {
  return themeVars(deriveTheme({ primary: b.primary, accent: b.accent, ink: b.ink }));
}
