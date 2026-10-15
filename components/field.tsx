import type { ReactNode } from "react";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export const controlClass =
  "h-9 w-full border border-input bg-background px-2.5 font-mono text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50";
