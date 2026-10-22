"use client";

import { useCallback, useEffect, useState } from "react";
import { PromiseCard } from "@/components/promise-card";
import { Avatars } from "@/components/promise-tile";
import { WalletButton } from "@/components/wallet-button";
import { Button } from "@/components/ui/button";
import { formatUsdc, formatWhen, PROOF_LABEL } from "@/lib/format";
import { STATUS_STYLE, countdown, progressOf, statusOf } from "@/lib/status";
import type { PromiseRecord } from "@/lib/types";

export function SharedPromise({ id }: { id: string }) {
  const [promise, setPromise] = useState<PromiseRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const res = await fetch(`/api/promises/${id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not load this promise.");
    setPromise(data);
  }, [id]);

  useEffect(() => {
    load()
      .then(() => {
        if (window.location.hash === "#back") setTimeout(() => document.getElementById("back")?.scrollIntoView({ behavior: "smooth" }), 100);
      })
      .catch((err) => setError(err.message));
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, [load]);

  async function check() {
    setChecking(true);
    setCheckError(undefined);
    try {
      const res = await fetch(`/api/promises/${id}/check`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "The check failed.");
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : String(err));
    }
    await load().catch(() => undefined);
    setChecking(false);
  }

  async function copy() {
    await navigator.clipboard.writeText(window.location.href.split("#")[0]).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const label = promise ? statusOf(promise, now, checking) : null;
  const stake = promise ? Number(promise.chain?.stakeUsdc ?? promise.stakeUsdc) : 0;
  const backed = promise ? (promise.chain ? Number(promise.chain.backedUsdc) : (promise.backings ?? []).reduce((s, b) => s + Number(b.amountUsdc), 0)) : 0;
  const backers = promise?.backings?.map((b) => b.backer) ?? [];
  const progress = promise ? progressOf(promise, now) : 0;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-5 pb-16">
      <nav className="flex items-center justify-between gap-3">
        <a href="/" className="flex items-center gap-2">
          <img src="/logo.png" alt="" width={36} height={36} className="size-9" />
          <span className="font-display text-lg font-bold">Proof of Promise</span>
        </a>
        <WalletButton />
      </nav>

      {error && <p role="alert" className="rounded-2xl border-2 border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}
      {!promise && !error && <div aria-busy="true" className="h-80 animate-pulse rounded-3xl border-2 bg-card" />}

      {promise && label && (
        <>
          <section className="pop flex flex-col gap-5 rounded-[2rem] border-2 bg-card p-6 sm:p-8">
            <div className="flex items-center justify-between gap-2">
              <span className={`rounded-full border px-3 py-1 text-sm font-bold ${STATUS_STYLE[label]}`}>{label}</span>
              <Button variant="outline" size="sm" onClick={copy}>{copied ? "Link copied" : "Copy link"}</Button>
            </div>
            <h1 className="font-display text-3xl leading-tight font-bold sm:text-4xl">{promise.description}</h1>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="font-display text-4xl font-bold text-primary tabular-nums sm:text-5xl">{formatUsdc(String(stake + backed))}</p>
                <p className="text-sm text-muted-foreground">USDC on the line{backed > 0 ? ` · ${formatUsdc(String(backed))} from backers` : ""}</p>
              </div>
              <div className="text-right">
                <p className="font-display text-2xl font-semibold">{countdown(promise.deadline, now)}</p>
                <p className="text-sm text-muted-foreground">{formatWhen(promise.deadline)}</p>
              </div>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Time used" aria-valuenow={Math.round(progress * 100)}>
              <div className={`h-full rounded-full ${progress >= 1 ? "bg-warm" : "bg-primary"}`} style={{ width: `${Math.max(4, progress * 100)}%` }} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                {backers.length > 0 ? <Avatars addresses={backers} size={32} /> : null}
                {backers.length > 0 ? `${backers.length} ${backers.length === 1 ? "backer" : "backers"}` : "No backers yet"}
              </span>
              <span>
                {PROOF_LABEL[promise.proofType]} proof · if broken, {promise.beneficiaryName} gets it
              </span>
            </div>
          </section>

          <PromiseCard
            promise={promise}
            standalone
            open
            onToggle={() => undefined}
            checking={checking}
            error={checkError}
            onCheck={check}
            onUploaded={load}
          />

          <a href="/#new" className="mx-auto flex items-center gap-3 rounded-3xl border-2 border-dashed border-primary/40 px-5 py-4 hover:border-primary">
            <img src="/logo.png" alt="" width={48} height={48} className="size-12" />
            <span>
              <span className="block font-display text-lg font-semibold">Got a goal of your own?</span>
              <span className="text-sm font-bold text-primary">Make a promise →</span>
            </span>
          </a>
        </>
      )}
    </main>
  );
}
