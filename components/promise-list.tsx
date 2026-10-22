"use client";

import Link from "next/link";
import { StatusDot } from "@/components/promise-detail";
import { PROOF_LABEL, formatUsdc } from "@/lib/format";
import { countdown, statusOf } from "@/lib/status";
import type { PromiseRecord } from "@/lib/types";

const COLS = "md:grid-cols-[120px_minmax(0,1fr)_110px_110px_140px_70px]";

export function PromiseList({ promises, now }: { promises: PromiseRecord[]; now: number }) {
  return (
    <div className="rounded-md border">
      <div className={`hidden gap-4 border-b px-4 py-2 text-xs text-muted-foreground md:grid ${COLS}`}>
        <span>Status</span>
        <span>Promise</span>
        <span>Proof</span>
        <span className="text-right">Amount</span>
        <span className="text-right">Deadline</span>
        <span className="text-right">Backers</span>
      </div>
      <ul className="divide-y">
        {promises.map((p) => {
          const stake = Number(p.chain?.stakeUsdc ?? p.stakeUsdc);
          const backed = p.chain ? Number(p.chain.backedUsdc) : (p.backings ?? []).reduce((s, b) => s + Number(b.amountUsdc), 0);
          const backers = p.backings?.length ?? 0;
          return (
            <li key={p.id}>
              <Link
                href={`/p/${p.id}`}
                className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-4 py-3 text-sm transition-colors duration-150 hover:bg-white/[0.03] md:items-center ${COLS}`}
              >
                <span className="order-2 text-right md:order-none md:text-left">
                  <StatusDot label={statusOf(p, now)} />
                </span>
                <span className="order-1 truncate md:order-none">{p.description}</span>
                <span className="order-3 text-muted-foreground md:order-none">{PROOF_LABEL[p.proofType]}</span>
                <span className="order-4 text-right font-mono md:order-none">{formatUsdc(String(stake + backed))}</span>
                <span className="hidden text-right font-mono text-muted-foreground md:block">{countdown(p.deadline, now)}</span>
                <span className="hidden text-right font-mono text-muted-foreground md:block">{backers}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
