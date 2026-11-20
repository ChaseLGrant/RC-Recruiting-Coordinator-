"use client";
import { useRef } from "react";


export function SearchBox({ defaultValue = "", size = "lg", autoFocus = false }: { defaultValue?: string; size?: "lg" | "md"; autoFocus?: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const big = size === "lg";
  return (
    <form ref={form} method="get" action="/discover" role="search" className={`flex flex-col gap-2 rounded-3xl sm:flex-row sm:items-end bg-white p-2 ring-1 ring-slate-900/10 transition focus-within:ring-2 focus-within:ring-brand-500 ${big ? "shadow-[0_8px_40px_rgba(11,23,48,0.12)]" : "shadow-[var(--shadow-soft)]"}`}>
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
      <button className={`w-full shrink-0 rounded-2xl bg-brand-600 sm:w-auto font-semibold text-white transition hover:bg-brand-700 ${big ? "px-6 py-3 text-base" : "px-4 py-2 text-sm"}`}>
        Find players
      </button>
    </form>
  );
}
