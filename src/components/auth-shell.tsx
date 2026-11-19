export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-b from-brand-900 to-slate-900 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center text-white">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-white text-lg font-bold text-brand-900">RC</div>
          <div className="text-xl font-semibold">Recruiting Coordinator</div>
          <div className="text-sm text-blue-200">Your standards. Your evaluations. Your recruiting decisions. RC does the legwork.</div>
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-xl">{children}</div>
      </div>
    </div>
  );
}
