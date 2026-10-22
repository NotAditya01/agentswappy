"use client";

import { useCallback, useEffect, useState } from "react";
import { PromiseDetail } from "@/components/promise-detail";
import { SiteHeader } from "@/components/site-header";
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
    load()
      .then(() => {
        if (window.location.hash === "#back") setTimeout(() => document.getElementById("back")?.scrollIntoView(), 50);
      })
      .catch((err) => setError(err.message));
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
    <div className="mx-auto flex w-full max-w-[1100px] flex-col px-4 sm:px-6">
      <SiteHeader />
      <nav className="pt-8 pb-8 text-sm">
        <a href="/" className="text-muted-foreground transition-colors duration-150 hover:text-foreground">← Promises</a>
      </nav>
      <main className="pb-24">
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!promise && !error && <p aria-busy="true" className="text-sm text-muted-foreground">Loading…</p>}
        {promise && <PromiseDetail promise={promise} checking={checking} error={checkError} onCheck={check} onUploaded={load} />}
      </main>
    </div>
  );
}
