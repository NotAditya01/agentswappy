"use client";

import { useEffect, useState } from "react";
import { PromiseForm } from "@/components/promise-form";
import { PromiseTile } from "@/components/promise-tile";
import { AskSwappy } from "@/components/ask-swappy";
import { Button } from "@/components/ui/button";
import { WalletButton } from "@/components/wallet-button";
import { formatUsdc } from "@/lib/format";
import type { PromisePrefill } from "@/lib/intent";
import type { Stats } from "@/lib/stats";
import type { PromiseRecord } from "@/lib/types";

type Meta = { hasApiKey: boolean; settlement: "mock" | "escrow" };
type Filter = "all" | "open" | "settled";

function isSettled(p: PromiseRecord) {
  return p.verdict === "kept" || p.verdict === "broken" || p.chain?.status === "expired";
}

const STEPS = [
  { title: "Promise it", text: "Say what you'll do, by when, and put some test USDC on it.", color: "bg-primary/15 text-primary", icon: <path d="M5 12l4 4L19 6" /> },
  {
    title: "Prove it",
    text: "Swappy reads your GitHub commits or looks at your photo.",
    color: "bg-blue-soft/15 text-blue-soft",
    icon: (
      <>
        <rect x="3" y="7" width="18" height="13" rx="3" />
        <circle cx="12" cy="13.5" r="3.5" />
        <path d="M8 7l1.5-3h5L16 7" />
      </>
    ),
  },
  {
    title: "Get paid back",
    text: "Kept it? Your USDC comes home. Missed it? Your friend gets it.",
    color: "bg-warm/15 text-warm",
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.4 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1 0-2-.5-2.5-1.5M12 6.5V8M12 16v1.5" />
      </>
    ),
  },
];

export function Dashboard() {
  const [promises, setPromises] = useState<PromiseRecord[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(6);
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
      .catch(() => setError("Could not load promises. Check your connection."))
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
    document.getElementById("promises")?.scrollIntoView({ behavior: "smooth" });
  }

  const filtered = promises.filter((p) => (filter === "all" ? true : filter === "settled" ? isSettled(p) : !isSettled(p)));
  const shown = filtered.slice(0, limit);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-16 px-4 pb-20 sm:px-6">
      <nav className="flex items-center justify-between gap-3 pt-5">
        <a href="/" className="flex items-center gap-2">
          <img src="/logo.png" alt="" width={36} height={36} className="size-9" />
          <span className="font-display text-lg font-bold">Proof of Promise</span>
        </a>
        <div className="flex items-center gap-5">
          <div className="hidden gap-5 text-sm font-semibold text-muted-foreground md:flex">
            <a href="#how" className="hover:text-foreground">How it works</a>
            <a href="#promises" className="hover:text-foreground">Promises</a>
            <a href="#ask" className="hover:text-foreground">Ask Swappy</a>
          </div>
          <WalletButton />
        </div>
      </nav>

      <header className="grid items-center gap-8 md:grid-cols-[1.2fr_1fr]">
        <div className="flex flex-col gap-6">
          <span className="w-fit rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
            Live on Base Sepolia testnet
          </span>
          <h1 className="font-display text-5xl leading-[1.02] font-bold sm:text-6xl">
            Make a promise.
            <br />
            <span className="text-primary">Swappy</span> keeps you honest.
          </h1>
          <p className="max-w-md text-lg text-muted-foreground">
            Put USDC on your goal. Hit it and you get it back. Miss it and your friend gets paid.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => setCreating(true)} className="h-14 px-7 text-base">
              Make a promise
            </Button>
            <Button variant="outline" onClick={() => document.getElementById("ask")?.scrollIntoView({ behavior: "smooth" })} className="h-14 px-6 text-base">
              Ask Swappy
            </Button>
          </div>
        </div>
        <div className="relative mx-auto">
          <div className="absolute inset-6 rounded-full bg-primary/20 blur-3xl" aria-hidden />
          <img src="/logo.png" alt="Swappy, the mascot" width={320} height={320} className="bob relative size-56 drop-shadow-2xl sm:size-80" />
          <span className="absolute -top-2 right-0 rotate-3 rounded-2xl rounded-br-sm bg-card px-4 py-2 font-display text-sm font-semibold shadow-lg ring-2 ring-primary/40 sm:right-[-1rem]">
            Show me the proof!
          </span>
        </div>
      </header>

      <section aria-label="Live numbers" className="grid grid-cols-3 gap-3 sm:gap-4">
        {[
          [stats ? formatUsdc(String(stats.lockedUsdc)) : "–", "USDC locked now", "text-primary"],
          [stats ? String(stats.kept) : "–", "promises kept", "text-foreground"],
          [stats ? String(stats.backers) : "–", stats?.backers === 1 ? "backer" : "backers", "text-warm"],
        ].map(([value, name, color]) => (
          <div key={name} className="rounded-3xl border-2 bg-card/70 px-3 py-5 text-center backdrop-blur sm:py-7">
            <p className={`font-display text-3xl font-bold tabular-nums sm:text-5xl ${color}`}>{value}</p>
            <p className="mt-1 text-xs font-semibold text-muted-foreground sm:text-sm">{name}</p>
          </div>
        ))}
      </section>

      <section id="how" className="flex scroll-mt-6 flex-col gap-6">
        <h2 className="font-display text-3xl font-bold">How it works</h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="lift flex gap-4 rounded-3xl border-2 bg-card p-5 md:flex-col">
              <span className={`flex size-14 shrink-0 items-center justify-center rounded-2xl ${step.color}`}>
                <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  {step.icon}
                </svg>
              </span>
              <div>
                <p className="font-display text-xl font-semibold">
                  <span className="text-muted-foreground">{i + 1}.</span> {step.title}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section id="promises" className="flex scroll-mt-6 flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="font-display text-3xl font-bold">Promises</h2>
          <div className="flex rounded-2xl border-2 bg-card p-1 text-sm font-bold" role="group" aria-label="Filter">
            {(["all", "open", "settled"] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => {
                  setFilter(f);
                  setLimit(6);
                }}
                className={`rounded-xl px-4 py-1.5 capitalize transition-colors ${filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {meta && !meta.hasApiKey && (
          <p role="status" className="rounded-2xl border-2 px-4 py-3 text-sm">Proof checks are off right now because Swappy has no AI key.</p>
        )}
        {error && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <span>{error}</span>
            <button type="button" onClick={load} className="font-bold underline underline-offset-4">Try again</button>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {loading && [0, 1, 2].map((i) => <div key={i} className="h-72 animate-pulse rounded-3xl border-2 bg-card" />)}
          {!loading && shown.map((p) => <PromiseTile key={p.id} promise={p} now={now} />)}
          {!loading && !error && filtered.length < 3 && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className={`lift flex min-h-72 flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-primary/40 p-6 text-center hover:border-primary ${filtered.length === 0 ? "sm:col-span-2 lg:col-span-3" : ""}`}
            >
              <img src="/logo.png" alt="" width={96} height={96} className="size-24" />
              <span className="font-display text-xl font-semibold">
                {filtered.length === 0 ? (promises.length === 0 ? "No promises yet. Be the first!" : `No ${filter} promises right now`) : "Your promise could be next"}
              </span>
              <span className="text-sm font-bold text-primary">Make a promise →</span>
            </button>
          )}
        </div>
        {filtered.length > limit && (
          <Button variant="outline" onClick={() => setLimit((n) => n + 6)} className="mx-auto h-12 px-6">
            Show more ({filtered.length - limit})
          </Button>
        )}
      </section>

      <section id="ask" className="scroll-mt-6">
        <AskSwappy onPrefill={fillForm} onChanged={refresh} />
      </section>

      <footer className="text-center text-sm text-muted-foreground">
        Test USDC on Base Sepolia. Built for the Rise In Agentmaxxing hackathon.
      </footer>

      {creating && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6" onClick={() => setCreating(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Make a promise"
            onClick={(e) => e.stopPropagation()}
            className="pop relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border-2 bg-card p-6 shadow-2xl sm:rounded-3xl"
          >
            <button type="button" onClick={() => setCreating(false)} aria-label="Close" className="absolute top-4 right-4 flex size-9 items-center justify-center rounded-full text-xl text-muted-foreground hover:bg-muted">
              ×
            </button>
            <PromiseForm onCreated={onCreated} prefill={prefill} />
          </div>
        </div>
      )}
    </div>
  );
}
