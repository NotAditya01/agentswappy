import type { ProofType, Verdict } from "./types";

export const PROOF_LABEL: Record<ProofType, string> = {
  github_commits: "GitHub commits",
  image: "Photo",
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  kept: "Kept",
  broken: "Broken",
  pending: "Not yet",
};

export function formatUsdc(amount: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return amount;
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function shortAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function dueLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown deadline";
  const diff = date.getTime() - now.getTime();
  const past = diff < 0;
  const minutes = Math.max(1, Math.round(Math.abs(diff) / 60_000));
  if (minutes < 60) return past ? `${minutes}m past deadline` : `Due in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return past ? `${hours}h past deadline` : `Due in ${hours}h`;
  const days = Math.round(hours / 24);
  return past ? `${days}d past deadline` : `Due in ${days}d`;
}

export function toLocalInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
