import { VERDICT_LABEL } from "./format";
import type { PromiseRecord } from "./types";

export type StatusLabel = "Open" | "Checking" | "Kept" | "Broken" | "Expired" | "Not yet" | "Check proof" | "Overdue";

export function statusOf(p: PromiseRecord, now: number, checking = false): StatusLabel {
  if (p.chain?.status === "expired") return "Expired";
  if (checking) return "Checking";
  if (p.verdict === "kept" || p.verdict === "broken") return VERDICT_LABEL[p.verdict] as StatusLabel;
  if (now > new Date(p.deadline).getTime()) return p.verdict === "pending" ? "Overdue" : "Check proof";
  return p.verdict ? (VERDICT_LABEL[p.verdict] as StatusLabel) : "Open";
}

export const STATUS_STYLE: Record<StatusLabel, string> = {
  Open: "border-primary/60 bg-primary/10 text-primary",
  Checking: "border-blue-soft/50 bg-blue-soft/15 text-blue-soft",
  Kept: "border-primary bg-primary text-primary-foreground",
  Broken: "border-destructive/60 bg-destructive/20 text-destructive",
  Expired: "border-border bg-secondary text-secondary-foreground",
  "Not yet": "border-border text-foreground",
  "Check proof": "border-warm/60 bg-warm/15 text-warm",
  Overdue: "border-warm bg-warm/25 text-warm",
};

export function progressOf(p: PromiseRecord, now: number): number {
  const start = new Date(p.createdAt).getTime();
  const end = new Date(p.deadline).getTime();
  if (!(end > start)) return 1;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

export function countdown(iso: string, now: number): string {
  const diff = new Date(iso).getTime() - now;
  if (Number.isNaN(diff)) return "";
  const past = diff < 0;
  const mins = Math.floor(Math.abs(diff) / 60_000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  const parts = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${Math.max(m, 1)}m`;
  return past ? `ended ${parts} ago` : `${parts} left`;
}

export function gradientFor(address: string): string {
  let h = 0;
  for (const c of address.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const a = h % 360;
  const b = (a + 40 + ((h >> 9) % 120)) % 360;
  return `linear-gradient(135deg, hsl(${a} 85% 60%), hsl(${b} 80% 45%))`;
}
