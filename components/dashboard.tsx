"use client";

import { useEffect, useState } from "react";
import { PromiseCard } from "@/components/promise-card";
import { PromiseForm } from "@/components/promise-form";
import { AskSwappy } from "@/components/ask-swappy";
import type { PromisePrefill } from "@/lib/intent";
import { Button } from "@/components/ui/button";
import { WalletButton } from "@/components/wallet-button";
import type { PromiseRecord } from "@/lib/types";
import type { Stats } from "@/lib/stats";
import { formatUsdc } from "@/lib/format";

type Tab = "promises" | "make" | "ask";
const TABS: [Tab, string][] = [
  ["promises", "Promises"],
  ["make", "Make a promise"],
  ["ask", "Ask Swappy"],
];

function isSettled(p: PromiseRecord) {
  return p.verdict === "kept" || p.verdict === "broken" || p.chain?.status === "expired";
}

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
  const [stats, setStats] = useState<Stats | null>(null);
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
    setStats(data.stats ?? null);
    return (data.promises ?? []) as PromiseRecord[];
  }

  const [tab, setTab] = useState<Tab | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "settled">("all");
  const [limit, setLimit] = useState(5);

  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.slice(1) as Tab;
      if (TABS.some(([id]) => id === h)) setTab(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    refresh()
      .then((list) => setTab((t) => t ?? (list.length ? "promises" : "make")))
      .catch(() => {
        setError("Could not load promises.");
        setTab((t) => t ?? "make");
      })
      .finally(() => setLoading(false));
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  async function reload() {
    await refresh();
  }

  function go(next: Tab) {
    setTab(next);
    history.replaceState(null, "", `#${next}`);
  }

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
    go("make");
  }

  async function onCreated() {
    const list = await refresh();
    setFilter("all");
    setOpenId(list[0]?.id ?? null);
    go("promises");
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

  const filtered = promises.filter((p) => (filter === "all" ? true : filter === "settled" ? isSettled(p) : !isSettled(p)));
  const shown = filtered.slice(0, limit);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-4 sm:py-6">
      <nav className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="" width={28} height={28} className="size-7" />
          <span className="font-semibold">Proof of Promise</span>
        </div>
        <WalletButton />
      </nav>

      <header className="flex flex-col gap-3">
        <p className="text-lg leading-snug">
          Put test USDC behind a promise. Swappy checks the proof, then you get it back, or your friend does.
        </p>
        <ol className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <li><span className="text-primary">1</span> Promise</li>
          <li><span className="text-primary">2</span> Prove with GitHub or a photo</li>
          <li><span className="text-primary">3</span> Kept: refund. Broken: friend gets it</li>
        </ol>
        {meta?.settlement !== "escrow" && <p className="text-sm text-muted-foreground">Money is simulated here.</p>}
      </header>

      {stats && (
        <dl className="grid grid-cols-3 border text-center">
          {[
            [`${formatUsdc(String(stats.lockedUsdc))}`, "USDC locked now"],
            [String(stats.kept), "promises kept"],
            [String(stats.backers), stats.backers === 1 ? "backer" : "backers"],
          ].map(([value, name]) => (
            <div key={name} className="border-r px-2 py-2 last:border-r-0">
              <dt className="sr-only">{name}</dt>
              <dd className="text-lg font-semibold tabular-nums">{value}</dd>
              <dd className="text-xs text-muted-foreground">{name}</dd>
            </div>
          ))}
        </dl>
      )}

      <div role="tablist" aria-label="Sections" className="grid grid-cols-3 border">
        {TABS.map(([id, name]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            onClick={() => go(id)}
            className={`h-11 px-2 text-sm ${tab === id ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {id === "make" ? (
              <>
                <span className="sm:hidden">New</span>
                <span className="hidden sm:inline">{name}</span>
              </>
            ) : (
              name
            )}
            {id === "promises" && !loading && promises.length > 0 ? ` (${promises.length})` : ""}
          </button>
        ))}
      </div>

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

      {tab === "ask" && <AskSwappy onPrefill={fillForm} onChanged={reload} />}

      {tab === "make" && <PromiseForm onCreated={onCreated} prefill={prefill} />}

      {tab === "promises" && (
        <section className="flex flex-col gap-3">
          {!loading && promises.length > 0 && (
            <div className="flex gap-1 text-sm">
              {(["all", "open", "settled"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter === f}
                  onClick={() => {
                    setFilter(f);
                    setLimit(5);
                  }}
                  className={`h-9 border px-3 capitalize ${filter === f ? "border-primary text-primary" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
          {loading && (
            <div aria-busy="true" aria-label="Loading promises" className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 animate-pulse border bg-card" />
              ))}
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="flex items-center gap-4 border px-4 py-5">
              {promises.length === 0 && <img src="/logo.png" alt="" width={72} height={72} className="size-18 shrink-0" />}
              <div>
              <p className="font-medium">{promises.length === 0 ? "No promises yet" : `No ${filter} promises`}</p>
              {promises.length === 0 && (
                <button type="button" onClick={() => go("make")} className="mt-2 text-sm text-primary underline underline-offset-4">
                  Make your first promise
                </button>
              )}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-2">
            {shown.map((promise) => (
              <PromiseCard
                key={promise.id}
                promise={promise}
                open={openId === promise.id}
                onToggle={() => setOpenId((id) => (id === promise.id ? null : promise.id))}
                checking={checkingId === promise.id}
                error={checkError?.id === promise.id ? checkError.message : undefined}
                onCheck={check}
                onUploaded={reload}
              />
            ))}
          </div>
          {filtered.length > limit && (
            <Button variant="outline" className="h-10" onClick={() => setLimit((n) => n + 5)}>
              Show more ({filtered.length - limit})
            </Button>
          )}
        </section>
      )}
    </main>
  );
}
