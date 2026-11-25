"use client";
import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

/** A submit button that shows it's working, so nobody wonders whether the tap registered. */
export function SubmitButton({ children, pending, className, name, value }: { children: ReactNode; pending?: ReactNode; className?: string; name?: string; value?: string }) {
  const { pending: busy } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={busy} aria-busy={busy} className={className}>
      {busy ? (
        <span className="inline-flex items-center gap-2.5">
          <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />
          {pending ?? "Working…"}
        </span>
      ) : children}
    </button>
  );
}
