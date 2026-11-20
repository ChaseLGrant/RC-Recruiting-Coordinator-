export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen bg-[#0f1722] lg:grid-cols-2">
      <div className="relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="absolute inset-0 bg-[repeating-linear-gradient(135deg,transparent_0_26px,rgba(255,255,255,0.03)_26px_52px)]" />
        <div className="relative flex items-center gap-3">
          <span className="font-display grid h-11 w-11 place-items-center bg-white text-xl font-extrabold text-[#0f1722]">RC</span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/60">Recruiting Coordinator</span>
        </div>
        <div className="relative">
          <h1 className="font-display text-7xl font-extrabold uppercase leading-[0.88]">Your standards.<br />Your decisions.<br /><span className="text-[#b8925a]">We do the legwork.</span></h1>
          <p className="mt-6 max-w-md text-[15px] leading-relaxed text-white/60">RC finds the players who fit your program, shows where every number came from, and never contacts a recruit without your OK.</p>
        </div>
        <p className="relative text-[11px] uppercase tracking-[0.18em] text-white/40">Powered by The Athlete Market</p>
      </div>
      <div className="grid place-items-center bg-[#f3f2ef] px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <span className="font-display grid h-10 w-10 place-items-center bg-[#0f1722] text-lg font-extrabold text-white">RC</span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Recruiting Coordinator</span>
          </div>
          <div className="border border-slate-900/10 border-t-4 border-t-[#1f3a68] bg-white p-7 shadow-sm">{children}</div>
        </div>
      </div>
    </div>
  );
}
