"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Four destinations, no more. Everything else lives in the account menu.
const TABS = [
  { href: "/", label: "Home", icon: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" },
  { href: "/following", label: "My Players", icon: "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM22 19v-1a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" },
  { href: "/schedule", label: "Schedule", icon: "M8 2v3M16 2v3M3.5 9h17M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" },
  { href: "/camps", label: "Camps", icon: "M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6" },
];

function isActive(path: string, href: string) {
  if (href === "/") return path === "/" || path.startsWith("/discover") || path.startsWith("/approvals");
  if (href === "/following") return path.startsWith("/following") || path.startsWith("/athletes") || path.startsWith("/compare");
  return path.startsWith(href);
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export function NavLinks({ pending }: { pending: number }) {
  const path = usePathname();
  return (
    <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={`relative rounded-full px-4 py-2 text-[15px] font-medium transition ${isActive(path, t.href) ? "bg-white/15 text-white" : "text-blue-100/80 hover:bg-white/10 hover:text-white"}`}>
          {t.label}
          {t.href === "/" && pending > 0 && <span className="ml-2 rounded-full bg-amber-400 px-1.5 py-0.5 text-[11px] font-bold text-amber-950">{pending}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function BottomTabs({ pending }: { pending: number }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <div className="grid grid-cols-4">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className={`relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${isActive(path, t.href) ? "text-brand-600" : "text-slate-500"}`}>
            <Icon d={t.icon} />
            {t.label}
            {t.href === "/" && pending > 0 && <span className="absolute right-[28%] top-1.5 rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-amber-950">{pending}</span>}
          </Link>
        ))}
      </div>
    </nav>
  );
}
