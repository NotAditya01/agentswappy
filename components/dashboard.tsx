"use client";

import { useEffect, useState } from "react";
import { PromiseCard } from "@/components/promise-card";
import { PromiseForm } from "@/components/promise-form";
import { AskSwappy } from "@/components/ask-swappy";
import type { PromisePrefill } from "@/lib/intent";
import { WalletButton } from "@/components/wallet-button";
import type { PromiseRecord } from "@/lib/types";

type Meta = {
  hasApiKey: boolean;
  model: string;
  hasGithubToken: boolean;
  settlement: "mock" | "escrow";
  network: "base-sepolia";
};

export function Dashboard() {
  const [promises, setPromises] = useState<PromiseRecord[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<{ id: string; message: string } | null>(null);

  async function refresh() {
    const res = await fetch("/api/promises");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not load promises.");
    setPromises(data.promises ?? []);
    setMeta(data.meta ?? null);
  }

  useEffect(() => {
    refresh()
      .catch(() => setError("Could not load promises."))
      .finally(() => setLoading(false));
  }, []);

  function retry() {
    setError(null);
    setLoading(true);
    refresh()
      .catch(() => setError("Could not load promises. Check your connection."))
      .finally(() => setLoading(false));
  }

  const [prefill, setPrefill] = useState<{ value: PromisePrefill; key: number } | null>(null);

  function fillForm(value: PromisePrefill) {
    setPrefill({ value, key: Date.now() });
    setTimeout(() => document.getElementById("promise-form")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  async function onCreated() {
    await refresh();
    document.getElementById("promises")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function check(id: string) {
    setCheckingId(id);
    setCheckError(null);
    setError(null);
    try {
      const res = await fetch(`/api/promises/${id}/check`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "The check failed.");
      await refresh();
    } catch (err) {
      setCheckError({ id, message: err instanceof Error ? err.message : String(err) });
      await refresh().catch(() => undefined);
    }
    setCheckingId(null);
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-6 sm:py-10">
      <nav className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="" width={32} height={32} className="size-8" />
          <span className="font-semibold">Swappy</span>
        </div>
        <WalletButton />
      </nav>

      <header className="flex flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Proof of Promise</h1>
        <p className="text-lg">
          Put a little USDC behind a promise. Swappy checks your proof and sends the money back to you, or to a friend if you miss it.
        </p>
        <ol className="grid gap-3 sm:grid-cols-3">
          {[
            ["1. Promise", "Say what you will do, by when, and how much you put on it."],
            ["2. Prove", "Swappy checks your GitHub commits or a photo you upload."],
            ["3. Settle", "Kept: you get it back. Broken: it goes to your friend."],
          ].map(([title, text]) => (
            <li key={title} className="border bg-card px-4 py-3">
              <p className="font-medium text-primary">{title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{text}</p>
            </li>
          ))}
        </ol>
        <p className="text-sm text-muted-foreground">
          {meta?.settlement === "escrow"
            ? "Runs on Base Sepolia testnet with test USDC. No wallet? You can still try it, the money part is just simulated."
            : "Money is simulated here. Nothing real moves."}
        </p>
        <a href="#promise-form" className="inline-flex h-11 w-full items-center justify-center bg-primary px-5 font-medium text-primary-foreground sm:w-fit">
          Make your first promise
        </a>
      </header>

      {!loading && meta && !meta.hasApiKey && (
        <p role="status" className="border px-4 py-3 text-sm">
          Proof checks are switched off right now because Swappy has no AI key. Nothing gets settled on a guess.
        </p>
      )}
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <span>{error}</span>
          <button type="button" onClick={retry} className="underline underline-offset-4">Try again</button>
        </div>
      )}

      <AskSwappy onPrefill={fillForm} onChanged={refresh} />

      <div id="promise-form" className="scroll-mt-6">
        <PromiseForm onCreated={onCreated} prefill={prefill} />
      </div>

      <section id="promises" className="flex flex-col gap-4 scroll-mt-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">Promises</h2>
          {!loading && promises.length > 0 && <span className="text-sm text-muted-foreground">{promises.length} total</span>}
        </div>
        {loading && (
          <div aria-busy="true" aria-label="Loading promises" className="flex flex-col gap-4">
            {[0, 1].map((i) => (
              <div key={i} className="h-40 animate-pulse border bg-card" />
            ))}
          </div>
        )}
        {!loading && !error && promises.length === 0 && (
          <div className="border px-4 py-6">
            <p className="font-medium">No promises yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Make one above and it shows up here, ready to check.</p>
          </div>
        )}
        {promises.map((promise) => (
          <PromiseCard
            key={promise.id}
            promise={promise}
            checking={checkingId === promise.id}
            error={checkError?.id === promise.id ? checkError.message : undefined}
            onCheck={check}
            onUploaded={refresh}
          />
        ))}
      </section>
    </main>
  );
}
