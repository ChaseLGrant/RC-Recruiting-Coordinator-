import Link from "next/link";
import type { ReactNode } from "react";

export function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(" ");
}

export function Card({ children, className, title, action, id }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <section id={id} className={cx("rounded-[4px] border border-slate-900/10 bg-white shadow-[var(--shadow-soft)]", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 px-5 pt-5">
          <h2 className="font-display text-xl font-bold uppercase tracking-wide text-slate-900">{title}</h2>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

const BADGE = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-rose-50 text-rose-800 ring-rose-200",
  blue: "bg-blue-50 text-blue-800 ring-blue-200",
  violet: "bg-violet-50 text-violet-800 ring-violet-200",
};

export function Badge({ children, tone = "slate", title }: { children: ReactNode; tone?: keyof typeof BADGE; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-[3px] px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", BADGE[tone])}>
      {children}
    </span>
  );
}

export function Button({
  children, variant = "primary", type = "submit", name, value, className, formAction, disabled, title,
}: {
  children: ReactNode; variant?: "primary" | "secondary" | "ghost" | "danger" | "success"; type?: "submit" | "button";
  name?: string; value?: string; className?: string; formAction?: (fd: FormData) => void | Promise<void>; disabled?: boolean; title?: string;
}) {
  const styles = {
    primary: "bg-brand-600 text-white shadow-sm hover:bg-brand-700",
    success: "bg-brand-600 text-white shadow-sm hover:bg-brand-700",
    secondary: "bg-white text-slate-800 ring-1 ring-inset ring-slate-200 hover:bg-slate-50",
    ghost: "text-slate-600 hover:bg-slate-100",
    danger: "bg-white text-rose-700 ring-1 ring-inset ring-rose-200 hover:bg-rose-50",
  };
  return (
    <button type={type} name={name} value={value} formAction={formAction} disabled={disabled} title={title}
      className={cx("inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[3px] px-4 py-2 text-[13px] font-bold uppercase tracking-[0.06em] transition disabled:opacity-50", styles[variant], className)}>
      {children}
    </button>
  );
}

export function LinkButton({ href, children, variant = "secondary", className }: { href: string; children: ReactNode; variant?: "primary" | "secondary"; className?: string }) {
  return (
    <Link href={href} className={cx("inline-flex min-h-10 items-center gap-1.5 rounded-[3px] px-4 py-2 text-[13px] font-bold uppercase tracking-[0.06em]",
      variant === "primary" ? "bg-brand-600 text-white hover:bg-brand-700" : "bg-white text-slate-800 ring-1 ring-inset ring-slate-200 hover:bg-slate-50", className)}>
      {children}
    </Link>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx("w-full rounded-[4px] border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100", props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx("rounded-[4px] border border-slate-200 bg-white px-2.5 py-2 text-sm focus:border-brand-600 focus:outline-none", props.className)} />;
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <label className={cx("mb-1 block text-xs font-medium text-slate-600", className)}>{children}</label>;
}

export function Flash({ flash, error }: { flash?: string; error?: string }) {
  if (!flash && !error) return null;
  return (
    <div role="status" className={cx("mb-5 rounded-[4px] px-4 py-3 text-sm ring-1 ring-inset", error ? "bg-rose-50 text-rose-800 ring-rose-200" : "bg-emerald-50 text-emerald-800 ring-emerald-200")}>
      {error ?? flash}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-[4px] bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-4xl font-extrabold uppercase leading-none text-slate-900 sm:text-5xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-[15px] text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function fmtDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
}

export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "never";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

export function Avatar({ first, last, size = "md" }: { first: string; last: string; size?: "md" | "lg" }) {
  const sz = size === "lg" ? "h-14 w-14 text-2xl sm:h-20 sm:w-20 sm:text-4xl" : "h-12 w-12 text-2xl";
  return <span className={cx("font-display grid shrink-0 place-items-center bg-brand-900 font-extrabold text-white shadow-[inset_0_-4px_0_var(--team-primary)]", sz)} aria-hidden>{(first[0] ?? "") + (last[0] ?? "")}</span>;
}
