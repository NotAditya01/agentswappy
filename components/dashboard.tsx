"use client";

import { useEffect, useState } from "react";
import { Check, Copy, RefreshCw, Wallet } from "lucide-react";
import { PromiseCard } from "@/components/promise-card";
import { PromiseForm } from "@/components/promise-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { buildDemoPromises } from "@/lib/demo";
import { formatUsdc, shortAddress } from "@/lib/format";
import type { PromiseRecord } from "@/lib/types";

type Meta = {
  hasApiKey: boolean;
  model: string;
  hasGithubToken: boolean;
  settlement: "mock";
  network: "base-sepolia";
};

type WalletInfo = { address: string | null; balance?: string };

export function Dashboard() {
  const [promises, setPromises] = useState<PromiseRecord[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [creatingWallet, setCreatingWallet] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [stubs, setStubs] = useState<Record<string, string>>({});

  async function refresh() {
    const [promiseRes, walletRes] = await Promise.all([fetch("/api/promises"), fetch("/api/wallet")]);
    const promiseData = await promiseRes.json();
    const walletData = await walletRes.json();
    setPromises(promiseData.promises ?? []);
    setMeta(promiseData.meta ?? null);
    setWallet(walletData);
  }

  useEffect(() => {
    refresh()
      .catch(() => setError("Could not load promises."))
      .finally(() => setLoading(false));
  }, []);

  async function addSamples() {
    setSeeding(true);
    setError(null);
    try {
      for (const draft of buildDemoPromises()) {
        const res = await fetch("/api/promises", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not add the sample promises.");
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await refresh().catch(() => undefined);
    }
    setSeeding(false);
  }

  async function createWallet() {
    setCreatingWallet(true);
    await fetch("/api/wallet", { method: "POST" });
    await refresh();
    setCreatingWallet(false);
  }

  async function check(id: string) {
    setCheckingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/promises/${id}/check`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "The check failed.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setCheckingId(null);
  }

  async function back(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/promises/${id}/back`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountUsdc: "1.00" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not reach the backing stub.");
      setStubs((current) => ({ ...current, [id]: data.message }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const kept = promises.filter((promise) => promise.verdict === "kept");
  const broken = promises.filter((promise) => promise.verdict === "broken");
  const pending = promises.filter((promise) => promise.verdict === "pending");
  const settledUsdc = promises.reduce((sum, promise) => sum + (promise.settlement ? Number(promise.settlement.amount) : 0), 0);

  return (
    <main className="mx-auto flex min-h-screen max-w-[1520px] flex-col gap-8 px-4 py-8 md:px-12 md:py-12">
      <header className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center font-mono text-xs font-medium tracking-[0.06em] text-muted-foreground uppercase">
            <img src="/risein-logo.svg" alt="Rise In" className="mr-3 h-5 w-auto" />
            <span className="text-foreground">/ Agentmaxxing</span>&nbsp;week 2
          </p>
          {meta && <p className="font-mono text-xs tracking-[0.06em] text-muted-foreground uppercase">Model: {meta.model}</p>}
        </div>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <h1 className="text-5xl leading-[0.9] font-bold tracking-[-0.045em] uppercase md:text-7xl">
              Proof of <span className="text-primary">promise.</span>
            </h1>
            <p className="mt-4 max-w-xl text-lg text-muted-foreground">
              State a promise and stake USDC. The agent checks the proof. Kept stakes are refunded. Broken stakes go to a friend or a charity.
            </p>
          </div>
          <Button type="button" onClick={addSamples} disabled={seeding} className="h-10 font-mono tracking-wider uppercase">
            {seeding ? "Adding..." : "Add sample promises"}
          </Button>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <Rule n="01" title="Stake" body="Write the promise, the deadline, the proof, and who receives a broken stake." />
        <Rule n="02" title="Agent checks" body="GitHub commits are real. Photos use vision. Strava is a stub and stays pending." />
        <Rule n="03" title="Settle" body="Refund or forfeit is recorded for Base Sepolia. This build moves no funds." />
      </section>

      {!meta?.hasApiKey && !loading && (
        <p className="border border-primary/40 bg-primary/10 px-4 py-3 text-sm">
          Add <code className="font-mono">GEMINI_API_KEY</code> to <code className="font-mono">.env</code> and restart so the agent writes the verdict. GitHub and Strava checks still run from the proof rules without a key. Photo checks need the key.
        </p>
      )}
      {meta && !meta.hasGithubToken && (
        <p className="text-sm text-muted-foreground">
          GitHub checks use the public API. A <code className="font-mono">GITHUB_TOKEN</code> with no scopes raises the 60 request/hour limit.
        </p>
      )}
      {error && <p className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Promises" value={String(promises.length)} />
        <Stat label="Kept" value={String(kept.length)} />
        <Stat label="Broken" value={String(broken.length)} />
        <Stat label="Pending" value={String(pending.length)} hint={`${formatUsdc(String(settledUsdc))} USDC mock settled`} />
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[420px_1fr]">
        <div className="flex flex-col gap-6">
          <PromiseForm onCreated={refresh} />
          <WalletCard wallet={wallet} creating={creatingWallet} onCreate={createWallet} onRefresh={refresh} />
        </div>
        <section className="flex min-w-0 flex-col gap-4">
          <p className="font-mono text-xs font-medium tracking-[0.06em] uppercase">
            <span className="text-primary">02</span>
            <span className="ml-3 text-muted-foreground">Dashboard</span>
          </p>
          {loading && <p className="text-muted-foreground">Loading promises…</p>}
          {!loading && promises.length === 0 && (
            <Card>
              <CardContent className="flex flex-col gap-2 py-8">
                <p className="text-xl font-bold tracking-tight uppercase">No promises yet</p>
                <p className="max-w-lg text-muted-foreground">
                  Add the sample set. Check the first GitHub promise (kept), the second (broken), then the Strava one (pending, no settlement). That is the two-minute demo.
                </p>
              </CardContent>
            </Card>
          )}
          {promises.map((promise) => (
            <PromiseCard
              key={promise.id}
              promise={promise}
              checking={checkingId === promise.id}
              stub={stubs[promise.id]}
              onCheck={check}
              onBack={back}
              onUploaded={refresh}
            />
          ))}
        </section>
      </div>
    </main>
  );
}

function Rule({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="border bg-card px-4 py-3">
      <p className="font-mono text-[11px] tracking-[0.06em] uppercase">
        <span className="text-primary">{n}</span>
        <span className="ml-2">{title}</span>
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border bg-card px-4 py-3">
      <p className="font-mono text-[11px] tracking-[0.06em] text-muted-foreground uppercase">{label}</p>
      <p className="text-2xl font-bold tracking-tight">{value}</p>
      {hint && <p className="font-mono text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function WalletCard({
  wallet,
  creating,
  onCreate,
  onRefresh,
}: {
  wallet: WalletInfo | null;
  creating: boolean;
  onCreate: () => void;
  onRefresh: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const address = wallet?.address;

  return (
    <Card>
      <CardHeader>
        <p className="font-mono text-xs font-medium tracking-[0.06em] uppercase">
          <span className="text-primary">03</span>
          <span className="ml-3 text-muted-foreground">Agent wallet</span>
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Week 3 friends sign x402 micropayments with this wallet. Week 2 settlement does not use it and does not move funds.
        </p>
        {!address && (
          <Button type="button" onClick={onCreate} disabled={creating} className="w-fit font-mono tracking-wider uppercase">
            <Wallet /> {creating ? "Creating..." : "Create wallet"}
          </Button>
        )}
        {address && (
          <div className="flex flex-col gap-2 border bg-background p-3">
            <div className="flex items-center justify-between gap-2">
              <code className="truncate font-mono text-xs text-primary" title={address}>
                {shortAddress(address)}
              </code>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Copy address"
                onClick={() => {
                  navigator.clipboard.writeText(address);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check /> : <Copy />}
              </Button>
            </div>
            <div className="flex items-center justify-between font-mono text-xs text-muted-foreground uppercase">
              <span>
                Balance <span className="text-foreground">{wallet?.balance ?? "…"}</span>
              </span>
              <Button type="button" variant="ghost" size="icon-xs" onClick={onRefresh} aria-label="Refresh balance">
                <RefreshCw />
              </Button>
            </div>
            <a className="font-mono text-xs uppercase hover:text-primary" href={`https://sepolia.basescan.org/address/${address}`} target="_blank" rel="noreferrer">
              Base Sepolia explorer
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
