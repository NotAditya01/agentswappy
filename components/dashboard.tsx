"use client";

import { useEffect, useState } from "react";
import { PromiseForm } from "@/components/promise-form";
import { PromiseList } from "@/components/promise-list";
import { AskSwappy } from "@/components/ask-swappy";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { formatUsdc } from "@/lib/format";
import type { PromisePrefill } from "@/lib/intent";
import type { Stats } from "@/lib/stats";
import type { PromiseRecord } from "@/lib/types";

type Meta = { hasApiKey: boolean; settlement: "mock" | "escrow" };
type Filter = "all" | "open" | "settled";

function isSettled(p: PromiseRecord) {
  return p.verdict === "kept" || p.verdict === "broken" || p.chain?.status === "expired";
}

export function Dashboard() {
  const [promises, setPromises] = useState<PromiseRecord[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(10);
  const [now, setNow] = useState(() => Date.now());
  const [prefill, setPrefill] = useState<{ value: PromisePrefill; key: number } | null>(null);

  async function refresh() {
    const res = await fetch("/api/promises");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not load promises.");
    setPromises(data.promises ?? []);
    setMeta(data.meta ?? null);
    setStats(data.stats ?? null);
  }

  function load() {
    setError(null);
    setLoading(true);
    refresh()
      .catch(() => setError("Could not load promises."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    if (window.location.hash === "#new") setCreating(true);
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!creating) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setCreating(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [creating]);

  function fillForm(value: PromisePrefill) {
    setPrefill({ value, key: Date.now() });
    setCreating(true);
  }

  async function onCreated() {
    setCreating(false);
    await refresh();
    setFilter("all");
  }

  const filtered = promises.filter((p) => (filter === "all" ? true : filter === "settled" ? isSettled(p) : !isSettled(p)));
  const shown = filtered.slice(0, limit);

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col px-4 sm:px-6">
      <SiteHeader />

      <section className="flex flex-col gap-4 pt-16 pb-12 sm:pt-24">
        <h1 className="max-w-2xl text-3xl font-semibold tracking-[-0.03em] sm:text-5xl">Put money on your promises.</h1>
        <p className="max-w-xl text-base text-muted-foreground">
          Stake test USDC on a goal. An agent checks the proof at the deadline and refunds you, or pays the friend you named.
        </p>
        <div className="flex gap-3 pt-4">
          <Button onClick={() => setCreating(true)} className="h-9 px-4">New promise</Button>
          <Button variant="outline" onClick={() => document.getElementById("ask-input")?.focus()} className="h-9 px-4">
            Ask Swappy <kbd className="ml-2 font-mono text-xs text-muted-foreground">/</kbd>
          </Button>
        </div>
      </section>

      <dl className="grid grid-cols-3 divide-x rounded-md border">
        {[
          ["Locked in open promises", stats ? `${formatUsdc(String(stats.lockedUsdc))}` : "—", "USDC"],
          ["Promises kept", stats ? String(stats.kept) : "—", ""],
          ["Backers", stats ? String(stats.backers) : "—", ""],
        ].map(([name, value, unit]) => (
          <div key={name} className="flex flex-col gap-1 px-4 py-4 sm:px-6 sm:py-5">
            <dt className="text-xs text-muted-foreground">{name}</dt>
            <dd className="font-mono text-xl tracking-tight sm:text-2xl">
              {value}
              {unit && <span className="ml-1.5 text-xs text-muted-foreground">{unit}</span>}
            </dd>
          </div>
        ))}
      </dl>

      <section className="pt-12">
        <AskSwappy onPrefill={fillForm} onChanged={refresh} />
      </section>

      <section className="flex flex-col gap-4 pt-12 pb-24">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-medium">Promises</h2>
          <div className="flex gap-1 text-sm" role="group" aria-label="Filter">
            {(["all", "open", "settled"] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => {
                  setFilter(f);
                  setLimit(10);
                }}
                className={`h-7 rounded-md px-2.5 capitalize transition-colors duration-150 ${filter === f ? "bg-white/[0.08] text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {meta && !meta.hasApiKey && <p role="status" className="text-sm text-muted-foreground">Proof checks are off: no AI key is configured.</p>}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}{" "}
            <button type="button" onClick={load} className="underline underline-offset-4">Retry</button>
          </p>
        )}
        {loading && <div aria-busy="true" className="h-24 rounded-md border" />}
        {!loading && !error && filtered.length === 0 && (
          <p className="rounded-md border px-4 py-8 text-center text-sm text-muted-foreground">
            {promises.length === 0 ? "No promises yet." : `No ${filter} promises.`}
          </p>
        )}
        {!loading && shown.length > 0 && <PromiseList promises={shown} now={now} />}
        {filtered.length > limit && (
          <Button variant="outline" onClick={() => setLimit((n) => n + 10)} className="h-8 self-start">
            Show {Math.min(10, filtered.length - limit)} more
          </Button>
        )}
      </section>

      <footer className="flex justify-between border-t py-6 font-mono text-xs text-muted-foreground">
        <span>Base Sepolia · test USDC only</span>
        <a href="https://github.com/NotAditya01/agentswappy" target="_blank" rel="noreferrer" className="transition-colors duration-150 hover:text-foreground">Source</a>
      </footer>

      {creating && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 sm:items-start sm:p-6 sm:pt-[10vh]" onClick={() => setCreating(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="New promise"
            onClick={(e) => e.stopPropagation()}
            className="relative max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-t-lg border bg-popover p-6 sm:rounded-lg"
          >
            <button type="button" onClick={() => setCreating(false)} aria-label="Close" className="absolute top-5 right-5 font-mono text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground">
              Esc
            </button>
            <PromiseForm onCreated={onCreated} prefill={prefill} />
          </div>
        </div>
      )}
    </div>
  );
}
