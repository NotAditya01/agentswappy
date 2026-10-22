import type { ReactNode } from "react";

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      {children}
      {error ? <span className="text-sm text-destructive">{error}</span> : hint ? <span className="text-sm text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export const controlClass =
  "w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-base outline-none transition-colors duration-150 focus-visible:border-white/40 disabled:cursor-not-allowed disabled:opacity-50";
