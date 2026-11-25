import Link from "next/link";

/** The RC wordmark: a squared monogram plus the full name. */
export function Wordmark({ href = "/", tone = "light", compact = false }: { href?: string; tone?: "light" | "dark"; compact?: boolean }) {
  const light = tone === "light";
  return (
    <Link href={href} className="group inline-flex items-center gap-3" aria-label="RC Recruiting Coordinator home">
      <span className={`font-display grid h-9 w-9 place-items-center text-[19px] font-extrabold leading-none ${light ? "bg-[#ecebe6] text-[#0a0b0d]" : "bg-[#0a0b0d] text-[#ecebe6]"}`}>RC</span>
      {!compact && (
        <span className={`hidden whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.22em] min-[420px]:inline ${light ? "text-white/70 group-hover:text-white" : "text-slate-600"}`}>Recruiting Coordinator</span>
      )}
    </Link>
  );
}
