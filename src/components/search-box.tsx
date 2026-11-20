"use client";
import { useRef } from "react";


export function SearchBox({ defaultValue = "", size = "lg", autoFocus = false }: { defaultValue?: string; size?: "lg" | "md"; autoFocus?: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const big = size === "lg";
  return (
    <form ref={form} method="get" action="/discover" role="search" className={`flex flex-col gap-2 rounded-[4px] bg-white p-2 transition focus-within:ring-2 focus-within:ring-[var(--team-primary)] sm:flex-row sm:items-end ${big ? "shadow-[0_12px_40px_rgba(0,0,0,0.35)]" : "border border-slate-900/15 shadow-[var(--shadow-soft)]"}`}>
      <label htmlFor="rc-search" className="sr-only">Describe the players you need</label>
      <textarea
        id="rc-search"
        name="q"
        rows={2}
        defaultValue={defaultValue}
        autoFocus={autoFocus}
        placeholder={"e.g. 2027 shortstops within 150 miles, 5'10\"+, 90+ exit velo"}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if ((e.currentTarget.value || "").trim()) form.current?.requestSubmit();
          }
        }}
        className={`min-w-0 flex-1 resize-none bg-transparent px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:outline-none ${big ? "text-lg" : "text-[15px]"}`}
      />
      <button className={`w-full shrink-0 rounded-[3px] bg-brand-600 font-bold uppercase tracking-[0.08em] text-white transition hover:bg-brand-700 sm:w-auto ${big ? "px-7 py-3.5 text-sm" : "px-5 py-2.5 text-xs"}`}>
        Find players
      </button>
    </form>
  );
}
