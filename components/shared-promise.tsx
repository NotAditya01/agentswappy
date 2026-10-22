"use client";

import { useCallback, useEffect, useState } from "react";
import { PromiseCard } from "@/components/promise-card";
import { WalletButton } from "@/components/wallet-button";
import type { PromiseRecord } from "@/lib/types";

export function SharedPromise({ id }: { id: string }) {
  const [promise, setPromise] = useState<PromiseRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | undefined>();

  const load = useCallback(async () => {
    const res = await fetch(`/api/promises/${id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not load this promise.");
    setPromise(data);
  }, [id]);

  useEffect(() => {
    load().catch((err) => setError(err.message));
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

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-4 sm:py-6">
      <nav className="flex flex-wrap items-center justify-between gap-3">
        <a href="/" className="flex items-center gap-2">
          <img src="/logo.png" alt="" width={28} height={28} className="size-7" />
          <span className="font-semibold">Proof of Promise</span>
        </a>
        <WalletButton />
      </nav>
      <p className="text-sm text-muted-foreground">
        Someone put test USDC behind this promise. Back it to cheer them on: if they keep it you get it back, if not it goes to their friend.
      </p>
      {error && <p role="alert" className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}
      {!promise && !error && <div aria-busy="true" className="h-48 animate-pulse border bg-card" />}
      {promise && (
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
      )}
      <a href="/" className="text-sm text-primary underline underline-offset-4">Make your own promise</a>
    </main>
  );
}
