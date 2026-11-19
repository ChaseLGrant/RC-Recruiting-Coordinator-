"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const PRIMARY = [
  { href: "/", label: "Home" },
  { href: "/discover", label: "Discover" },
  { href: "/following", label: "Following" },
  { href: "/schedule", label: "Schedule" },
  { href: "/camps", label: "Camps" },
];
const SECONDARY = [
  { href: "/missions", label: "Missions" },
  { href: "/impact", label: "Impact" },
  { href: "/settings", label: "Settings" },
];

export function NavLinks({ pending }: { pending: number }) {
  const path = usePathname();
  const active = (h: string) => (h === "/" ? path === "/" || path.startsWith("/approvals") : path.startsWith(h));
  return (
    <nav className="flex flex-wrap items-center gap-1 text-sm">
      {PRIMARY.map((l) => (
        <Link key={l.href} href={l.href} className={`rounded-lg px-3 py-1.5 font-medium ${active(l.href) ? "bg-brand-50 text-brand-700" : "text-slate-700 hover:bg-slate-100"}`}>
          {l.label}
          {l.href === "/" && pending > 0 && <span className="ml-1.5 rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">{pending}</span>}
        </Link>
      ))}
      <span className="mx-1 h-5 w-px bg-slate-200" />
      {SECONDARY.map((l) => (
        <Link key={l.href} href={l.href} className={`rounded-lg px-2.5 py-1.5 text-xs ${active(l.href) ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:bg-slate-100"}`}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
