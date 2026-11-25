"use client";
/* eslint-disable @next/next/no-img-element */
import { useActionState, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useFormStatus } from "react-dom";
import { createSchoolDemoAction, type DemoFormState } from "@/app/actions";
import { COLOR_PRESETS, deriveTheme, normalizeHex, themeVars } from "@/lib/theme";

const STEPS = ["Setting up your program", "Placing sample players near campus", "Running your first search", "Filling the board with a week of staff work"];

export function DemoForm({ initialSchool = "" }: { initialSchool?: string }) {
  const [state, action] = useActionState<DemoFormState, FormData>(createSchoolDemoAction, undefined);
  const [school, setSchool] = useState(initialSchool);
  const [teamName, setTeamName] = useState("");
  const [preset, setPreset] = useState(COLOR_PRESETS[0].id);
  const [custom, setCustom] = useState({ primary: "#0c2340", accent: "#c99700" });
  const [logo, setLogo] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [campus, setCampus] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  // React clears file inputs after a submit; keep the preview honest if the server sent the form back.
  useEffect(() => { if (state?.error) setLogo(null); }, [state]);

  const colors = preset === "custom" ? custom : COLOR_PRESETS.find((p) => p.id === preset) ?? COLOR_PRESETS[0];
  const theme = useMemo(() => deriveTheme({ primary: colors.primary, accent: colors.accent }), [colors.primary, colors.accent]);
  const team = teamName.trim() || (school.trim() ? (/baseball/i.test(school) ? school.trim() : `${school.trim()} Baseball`) : "Your Program Baseball");

  function onLogo(e: React.ChangeEvent<HTMLInputElement>) {
    setLogoError(null);
    const f = e.target.files?.[0];
    if (!f) return setLogo(null);
    if (!["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(f.type)) {
      setLogoError("Use a PNG, JPG, WebP or SVG file.");
      e.target.value = "";
      return setLogo(null);
    }
    if (f.size > 500_000) {
      setLogoError("Logo must be under 500 KB.");
      e.target.value = "";
      return setLogo(null);
    }
    const r = new FileReader();
    r.onload = () => setLogo(String(r.result));
    r.readAsDataURL(f);
  }

  return (
    <form action={action} className="grid gap-10 lg:grid-cols-[1fr_0.95fr]">
      <div className="space-y-6">
        {state?.error && <p role="alert" className="border-l-2 border-rose-400 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{state.error}</p>}
        <div>
          <label htmlFor="school" className="site-label">School or program</label>
          <input id="school" name="school" required minLength={2} maxLength={60} autoComplete="organization" value={school} onChange={(e) => setSchool(e.target.value)} placeholder="e.g. Coastal State University" className="site-field" />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="teamName" className="site-label">Name in the header <span className="normal-case tracking-normal text-[var(--site-dim)]">(optional)</span></label>
            <input id="teamName" name="teamName" maxLength={40} value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder={team} className="site-field" />
          </div>
          <div>
            <label htmlFor="campus" className="site-label">Campus ZIP or City, ST <span className="normal-case tracking-normal text-[var(--site-dim)]">(optional)</span></label>
            <input id="campus" name="campus" maxLength={60} value={campus} onChange={(e) => setCampus(e.target.value)} placeholder="92069 or San Marcos, CA" className="site-field" />
          </div>
        </div>

        <fieldset>
          <legend className="site-label">Team colors</legend>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {COLOR_PRESETS.map((p) => (
              <label key={p.id} title={p.label} className="group relative cursor-pointer">
                <input type="radio" name="preset" value={p.id} checked={preset === p.id} onChange={() => setPreset(p.id)} className="peer sr-only" />
                <span className="flex h-11 overflow-hidden rounded-[3px] ring-1 ring-white/10 transition peer-checked:ring-2 peer-checked:ring-[var(--site-text)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--site-brass)]">
                  <span className="flex-[2]" style={{ background: p.primary }} />
                  <span className="flex-1" style={{ background: p.accent }} />
                </span>
                <span className="sr-only">{p.label}</span>
              </label>
            ))}
          </div>
          <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-sm text-[var(--site-muted)]">
            <input type="radio" name="preset" value="custom" checked={preset === "custom"} onChange={() => setPreset("custom")} className="accent-[#c9a46a]" />
            Use my exact colors
          </label>
          {preset === "custom" && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <ColorField label="Primary" value={custom.primary} onChange={(v) => setCustom((c) => ({ ...c, primary: v }))} />
              <ColorField label="Secondary" value={custom.accent} onChange={(v) => setCustom((c) => ({ ...c, accent: v }))} />
            </div>
          )}
          <p className="mt-2 text-xs text-[var(--site-dim)]">{COLOR_PRESETS.find((p) => p.id === preset)?.label ?? "Custom colors"} · text colors are picked automatically so everything stays readable.</p>
          <input type="hidden" name="primary" value={colors.primary} />
          <input type="hidden" name="accent" value={colors.accent} />
        </fieldset>

        <div>
          <span className="site-label">Logo <span className="normal-case tracking-normal text-[var(--site-dim)]">(optional · PNG, JPG, WebP or SVG, under 500 KB)</span></span>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => fileRef.current?.click()} className="btn-line !min-h-11 !px-4 !text-[12px]">{logo ? "Change logo" : "Upload logo"}</button>
            {logo && <button type="button" onClick={() => { setLogo(null); if (fileRef.current) fileRef.current.value = ""; }} className="text-sm text-[var(--site-muted)] underline underline-offset-4 hover:text-white">Remove</button>}
            <input ref={fileRef} type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={onLogo} className="sr-only" tabIndex={-1} aria-label="Logo file" />
          </div>
          {logoError && <p className="mt-2 text-sm text-rose-300">{logoError}</p>}
          <p className="mt-2 text-xs text-[var(--site-dim)]">Only upload a logo your program is allowed to use. It stays in your private demo.</p>
        </div>

        <div className="border-t border-[var(--site-line)] pt-6">
          <Submit team={team} />
          <p className="mt-3 text-xs leading-relaxed text-[var(--site-dim)]">Private to you. Every player in the demo is fictional and clearly labeled. Nothing is sent to anyone. The demo deletes itself after 14 days.</p>
        </div>
      </div>

      {/* Live preview */}
      <div className="lg:sticky lg:top-24 lg:self-start">
        <p className="site-label">Preview</p>
        <Preview team={team} logo={logo} vars={themeVars(theme) as CSSProperties} />
      </div>
      <BuildingOverlay team={team} vars={themeVars(theme) as CSSProperties} logo={logo} />
    </form>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  return (
    <label className="flex items-center gap-2 rounded-[3px] border border-[var(--site-line-strong)] bg-[#0d0f12] p-1.5 pr-3">
      <input type="color" value={value} onChange={(e) => { onChange(e.target.value); setText(e.target.value); }} className="h-9 w-10 cursor-pointer rounded-[2px] border-0 bg-transparent p-0" aria-label={`${label} color`} />
      <span className="flex-1">
        <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--site-dim)]">{label}</span>
        <input value={text} onChange={(e) => { setText(e.target.value); const h = normalizeHex(e.target.value); if (h) onChange(h); }} className="w-full bg-transparent font-mono text-sm uppercase text-[var(--site-text)] outline-none" aria-label={`${label} hex`} />
      </span>
    </label>
  );
}

function Mark({ team, logo, size = "h-10 w-10 text-xl" }: { team: string; logo: string | null; size?: string }) {
  return logo ? (
    <img src={logo} alt="" className="h-10 w-auto max-w-[4.5rem] object-contain" />
  ) : (
    <span className={`font-display grid shrink-0 place-items-center bg-[var(--team-mark)] font-extrabold text-[var(--team-on-mark)] ${size}`}>{team.slice(0, 1).toUpperCase()}</span>
  );
}

function Preview({ team, logo, vars }: { team: string; logo: string | null; vars: CSSProperties }) {
  return (
    <div style={vars} className="overflow-hidden rounded-[6px] border border-[var(--site-line-strong)] bg-[#f3f2ef] text-[#111418] shadow-2xl transition-colors">
      <div className="flex items-center gap-2 bg-[#0a0b0d] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/75"><span className="rounded-[2px] bg-[var(--team-mark)] px-1 font-extrabold text-[var(--team-on-mark)]">Demo</span>Fictional players</div>
      <div className="flex items-center gap-3 border-b-4 border-[var(--team-primary-on-ink)] bg-[var(--team-ink)] px-4 py-3 text-white">
        <Mark team={team} logo={logo} />
        <span className="min-w-0 leading-none">
          <span className="font-display block truncate text-xl font-extrabold uppercase tracking-wide">{team}</span>
          <span className="mt-1 block text-[9px] font-semibold uppercase tracking-[0.18em] text-white/60">Recruiting Coordinator</span>
        </span>
      </div>
      <div className="bg-[var(--team-ink)] px-4 pb-5 pt-4 text-white">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/60">Good morning, Coach</p>
        <p className="font-display mt-1 text-3xl font-extrabold uppercase leading-[0.9]">Who are you<br />looking for?</p>
        <div className="mt-3 flex gap-2">
          <span className="flex-1 truncate rounded-[3px] bg-white px-3 py-2 text-xs text-slate-400">2027 shortstops within 150 miles</span>
          <span className="rounded-[3px] bg-[var(--team-primary)] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--team-on-primary)]">Find</span>
        </div>
      </div>
      <div className="grid grid-cols-3 divide-x divide-slate-900/10 border-b border-slate-900/10 bg-white">
        {[["New players", "12"], ["Waiting on you", "7"], ["Games this week", "4"]].map(([l, n], i) => (
          <div key={l} className="px-3 py-3">
            <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">{l}</p>
            <p className={`font-display mt-1 text-3xl font-extrabold leading-none ${i === 1 ? "text-[var(--team-primary-text)]" : "text-slate-900"}`}>{n}</p>
          </div>
        ))}
      </div>
      <div className="space-y-2 p-3">
        {["Marcus Reyes · SS · 2027", "Tyler Brooks · RHP · 2028"].map((n, i) => (
          <div key={n} className="flex items-center justify-between border border-slate-900/10 bg-white px-3 py-2.5 text-xs">
            <span className="font-semibold">{n} <span className="ml-1 rounded-[2px] bg-slate-100 px-1 text-[9px] font-bold text-slate-500">DEMO</span></span>
            <span className={`rounded-[3px] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.06em] ${i === 0 ? "bg-[var(--team-primary)] text-[var(--team-on-primary)]" : "bg-[var(--team-accent)] text-[var(--team-on-accent)]"}`}>{i === 0 ? "Approve" : "Priority"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Submit({ team }: { team: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className="btn-solid w-full sm:w-auto">
      {pending ? "Building your board…" : `Build the ${team} demo`}
    </button>
  );
}

function BuildingOverlay({ team, vars, logo }: { team: string; vars: CSSProperties; logo: string | null }) {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return (
    <div style={vars} role="status" aria-live="polite" className="fixed inset-0 z-50 grid place-items-center bg-[var(--team-ink)] px-6 text-white">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3">
          <Mark team={team} logo={logo} size="h-12 w-12 text-2xl" />
          <p className="font-display text-2xl font-extrabold uppercase leading-none">{team}</p>
        </div>
        <p className="font-display mt-10 text-5xl font-extrabold uppercase leading-[0.9]">Building<br />your board</p>
        <div className="mt-6 h-1 w-full overflow-hidden bg-white/10"><div className="build-progress h-full w-full bg-[var(--team-primary-on-ink)]" /></div>
        <ul className="mt-6 space-y-2 text-sm text-white/70">
          {STEPS.map((s, i) => <li key={s} className="rise" style={{ animationDelay: `${i * 0.6}s` }}>{s}…</li>)}
        </ul>
      </div>
    </div>
  );
}
