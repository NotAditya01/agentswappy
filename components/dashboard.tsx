"use client";

import { useEffect, useState } from "react";
import { PromiseCard } from "@/components/promise-card";
import { PromiseForm } from "@/components/promise-form";
import type { PromiseRecord } from "@/lib/types";

type Meta = {
  hasApiKey: boolean;
  model: string;
  hasGithubToken: boolean;
  settlement: "mock";
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
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8 sm:py-12">
      <header className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">Settlement is simulated. No real money moves.</p>
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="" width={44} height={44} className="size-11" />
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Swappy</h1>
        </div>
        <p className="text-base text-muted-foreground">
          Make a promise, find it in the list, then check the proof. The agent calls a tool, reads the result, and decides if you kept it.
        </p>
      </header>

      {!loading && meta && !meta.hasApiKey && (
        <p role="status" className="border px-4 py-3 text-sm">
          GEMINI_API_KEY is not set, so Check proof cannot run. Add the key and try again. Nothing is settled from a guess.
        </p>
      )}
      {error && (
        <p role="alert" className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <PromiseForm onCreated={onCreated} />

      <section id="promises" className="flex flex-col gap-4 scroll-mt-6">
        <div>
          <p className="text-sm text-muted-foreground">Step 2</p>
          <h2 className="text-xl font-semibold tracking-tight">Your promises</h2>
        </div>
        {loading && <p className="text-sm text-muted-foreground">Loading your promises…</p>}
        {!loading && promises.length === 0 && (
          <div className="border px-4 py-6">
            <p className="font-medium">No promises yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Make one above. Try an example only fills the form — it does not create a result.
            </p>
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
