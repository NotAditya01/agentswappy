import type { ReactNode } from "react";

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint ? <span className="text-sm text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export const controlClass =
  "w-full min-w-0 border border-input bg-background px-3 py-2 text-base outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50";
