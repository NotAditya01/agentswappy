"use client";

import Link from "next/link";
import { formatUsdc, PROOF_LABEL } from "@/lib/format";
import { STATUS_STYLE, countdown, gradientFor, progressOf, statusOf } from "@/lib/status";
import type { PromiseRecord } from "@/lib/types";

export function Avatars({ addresses, size = 28 }: { addresses: string[]; size?: number }) {
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()))];
  return (
    <span className="flex -space-x-2">
      {unique.slice(0, 4).map((a) => (
        <span key={a} title={a} className="rounded-full border-2 border-card" style={{ width: size, height: size, background: gradientFor(a) }} />
      ))}
    </span>
  );
}

export function PromiseTile({ promise, now }: { promise: PromiseRecord; now: number }) {
  const label = statusOf(promise, now);
  const stake = Number(promise.chain?.stakeUsdc ?? promise.stakeUsdc);
  const backed = promise.chain ? Number(promise.chain.backedUsdc) : (promise.backings ?? []).reduce((s, b) => s + Number(b.amountUsdc), 0);
  const backers = (promise.backings ?? []).map((b) => b.backer);
  const progress = progressOf(promise, now);
  const canBack = promise.chain?.status === "open" && label === "Open";
  const href = `/p/${promise.id}`;

  return (
    <article className="lift relative flex flex-col gap-4 rounded-3xl border-2 bg-card p-5 hover:border-primary/40">
      <div className="flex items-center justify-between gap-2">
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${STATUS_STYLE[label]}`}>{label}</span>
        <span className="text-xs text-muted-foreground">{PROOF_LABEL[promise.proofType]}</span>
      </div>
      <h3 className="font-display text-lg leading-snug font-semibold">
        <Link href={href} className="line-clamp-2 after:absolute after:inset-0 after:content-['']">
          {promise.description}
        </Link>
      </h3>
      <div>
        <p className="font-display text-3xl font-bold tabular-nums">
          {formatUsdc(String(stake + backed))} <span className="text-base font-medium text-muted-foreground">USDC</span>
        </p>
        <p className="text-xs text-muted-foreground">If broken, it goes to {promise.beneficiaryName}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Time used" aria-valuenow={Math.round(progress * 100)}>
          <div className={`h-full rounded-full ${progress >= 1 ? "bg-warm" : "bg-primary"}`} style={{ width: `${Math.max(4, progress * 100)}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">{countdown(promise.deadline, now)}</p>
      </div>
      <div className="mt-auto flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          {backers.length > 0 ? (
            <>
              <Avatars addresses={backers} />
              {backers.length} {backers.length === 1 ? "backer" : "backers"}
            </>
          ) : canBack ? (
            "No backers yet"
          ) : (
            ""
          )}
        </span>
        {canBack ? (
          <Link
            href={`${href}#back`}
            className="relative z-10 inline-flex h-10 items-center rounded-2xl bg-warm px-4 text-sm font-bold text-[#1A1206] shadow-[0_4px_0_var(--warm-deep)] active:translate-y-[3px] active:shadow-none"
          >
            Back it
          </Link>
        ) : (
          <span className="text-sm font-bold text-primary">View →</span>
        )}
      </div>
    </article>
  );
}
