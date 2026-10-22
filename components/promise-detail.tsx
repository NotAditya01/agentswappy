"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PROOF_LABEL, formatUsdc, formatWhen, shortAddress } from "@/lib/format";
import { countdown, statusOf, type StatusLabel } from "@/lib/status";
import { txUrl } from "@/lib/escrow";
import { backWithX402, expireOnchain } from "@/lib/fund";
import { Input } from "@/components/ui/input";
import { walletErrorMessage } from "@/lib/wallet-error";
import { useWallet } from "@/components/wallet-provider";
import { needsOnchainSettle } from "@/lib/stake";
import { shrinkPhoto } from "@/lib/shrink";
import type { PromiseRecord, TraceStep } from "@/lib/types";


const TOOL_LABEL: Record<string, string> = {
  check_github_commits: "Looked up GitHub commits",
  check_image_proof: "Looked at the photo",
  record_verdict: "Wrote the verdict",
  settle_stake: "Settled the stake",
};

const STATUS_STYLE: Record<string, string> = {
  Kept: "bg-primary text-primary-foreground",
  Broken: "bg-destructive/20 text-destructive",
  Expired: "bg-secondary text-secondary-foreground",
  Checking: "bg-blue-soft/20 text-blue-soft",
  "Not yet": "border-border text-foreground",
  "Check proof": "bg-amber-400/15 text-amber-300 border-amber-400/50",
  Overdue: "bg-amber-400/25 text-amber-200 border-amber-400",
  Open: "border-primary/60 text-primary",
};


function summaryOf(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const summary = (result as { summary?: unknown }).summary;
  return typeof summary === "string" ? summary : null;
}

function factsOf(result: unknown): { label: string; value: string }[] {
  if (!result || typeof result !== "object") return [];
  const evidence = (result as { evidence?: unknown }).evidence;
  if (!evidence || typeof evidence !== "object") return [];
  const row = evidence as Record<string, unknown>;
  const facts: { label: string; value: string }[] = [];
  if (typeof row.owner === "string" && typeof row.repo === "string") {
    facts.push({ label: "Repository", value: `${row.owner}/${row.repo}` });
  }
  if (typeof row.since === "string") facts.push({ label: "From", value: row.since });
  if (typeof row.until === "string") facts.push({ label: "Until", value: row.until });
  if (typeof row.commitCount === "number") facts.push({ label: "Commits found", value: String(row.commitCount) });
  if (typeof row.bytesSent === "number") facts.push({ label: "Photo sent", value: `${row.bytesSent} bytes` });
  if (typeof row.observation === "string" && row.observation) facts.push({ label: "What Gemini saw", value: row.observation });
  if (row.sentToVision === false) facts.push({ label: "Photo", value: "Not sent" });
  return facts;
}

export function PromiseDetail({
  promise,
  checking,
  error,
  onCheck,
  onUploaded,
}: {
  promise: PromiseRecord;
  checking: boolean;
  error?: string;
  onCheck: (id: string) => void;
  onUploaded: () => Promise<void>;
}) {
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const wallet = useWallet();
  const [expiring, setExpiring] = useState(false);
  const [expireError, setExpireError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const chainState = promise.chain;
  const expired = chainState?.status === "expired";
  const settled = promise.verdict === "kept" || promise.verdict === "broken" || expired;
  const label = statusOf(promise, now, checking);
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = `${window.location.origin}/p/${promise.id}`;
    try {
      {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }
    } catch {}
  }
  const stake = chainState?.stakeUsdc ?? promise.stakeUsdc;
  const backed = chainState ? Number(chainState.backedUsdc) : (promise.backings ?? []).reduce((sum, b) => sum + Number(b.amountUsdc), 0);
  const canBack = chainState?.status === "open" && now < new Date(promise.deadline).getTime() && !promise.verdict;
  const [backAmount, setBackAmount] = useState("0.5");
  const [backStep, setBackStep] = useState<string | null>(null);
  const [backError, setBackError] = useState<string | null>(null);
  const canExpire = chainState?.status === "open" && now > new Date(chainState.expiresAt).getTime();

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  async function expire() {
    if (!promise.onchain) return;
    setExpiring(true);
    setExpireError(null);
    try {
      const from = wallet.account ?? (await wallet.connect());
      if (!from) throw new Error(wallet.error || "Connect a wallet first.");
      await expireOnchain(promise.onchain.escrowId, from);
      await onUploaded();
    } catch (err) {
      setExpireError(walletErrorMessage(err));
    }
    setExpiring(false);
  }

  async function back() {
    setBackError(null);
    setBackStep("Connecting your wallet…");
    try {
      const from = wallet.account ?? (await wallet.connect());
      if (!from) throw new Error(wallet.error || "Connect a wallet first.");
      await backWithX402(promise.id, backAmount, from, setBackStep);
      await onUploaded();
    } catch (err) {
      setBackError(walletErrorMessage(err));
    }
    setBackStep(null);
  }

  useEffect(() => {
    if (!checking) return;
    setSeconds(0);
    const id = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [checking]);

  async function upload(file: File | null) {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const body = new FormData();
      body.append("image", await shrinkPhoto(file));
      const res = await fetch(`/api/promises/${promise.id}/proof`, { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed.");
      await onUploaded();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    }
    setUploading(false);
  }

  const total = Number(stake) + backed;
  const backers = promise.backings ?? [];

  return (
    <div className="grid gap-12 md:grid-cols-[minmax(0,1fr)_320px]" aria-busy={checking}>
      <div className="flex min-w-0 flex-col gap-10">
        <div className="flex flex-col gap-3">
          <StatusDot label={label} />
          <h1 className="text-2xl font-semibold tracking-[-0.02em] break-words sm:text-3xl">{promise.description}</h1>
        </div>

        <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-x-6 gap-y-3 border-t pt-6 text-sm">
          <KV k="Amount"><span className="font-mono">{formatUsdc(String(total))} USDC</span>{backed > 0 && <span className="text-muted-foreground"> · <span className="font-mono">{formatUsdc(String(stake))}</span> stake + <span className="font-mono">{formatUsdc(String(backed))}</span> backed</span>}</KV>
          <KV k="Deadline"><span className="font-mono">{formatWhen(promise.deadline)}</span><span className="text-muted-foreground"> · <span className="font-mono">{countdown(promise.deadline, now)}</span></span></KV>
          <KV k="Proof">{PROOF_LABEL[promise.proofType]} · {promise.target}</KV>
          <KV k="If broken">{promise.beneficiaryName}{promise.onchain && <span className="text-muted-foreground"> · <span className="font-mono">{shortAddress(promise.beneficiaryAddress)}</span></span>}</KV>
          <KV k="Backers">{backers.length === 0 ? <span className="text-muted-foreground">None</span> : backers.map((b) => <span key={b.creditTx} className="block font-mono">{shortAddress(b.backer)} · {formatUsdc(b.amountUsdc)}</span>)}</KV>
          <KV k="Escrow">{promise.onchain ? <span className="font-mono">{chainState?.status ?? "unknown"}</span> : <span className="text-muted-foreground">Simulated, no wallet</span>}</KV>
        </dl>

        {(promise.onchain || backers.length > 0 || (promise.settlement && promise.settlement.txHash)) && (
          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-medium text-muted-foreground">Transactions</h2>
            <div className="divide-y rounded-md border text-sm">
              {promise.onchain && <TxLink label="Stake locked" hash={promise.onchain.createTx} />}
              {backers.map((b) => <TxLink key={b.creditTx} label={`Backed ${formatUsdc(b.amountUsdc)}`} hash={b.creditTx} />)}
              {promise.settlement?.txHash && <TxLink label={promise.settlement.outcome === "refund" ? "Refunded" : "Paid out"} hash={promise.settlement.txHash} />}
            </div>
          </section>
        )}

        {promise.proofType === "image" && promise.imageProof && (
          <img
            src={`/api/promises/${promise.id}/proof?v=${encodeURIComponent(promise.imageProof.uploadedAt)}`}
            alt={promise.imageProof.fileName}
            className="max-h-72 w-fit max-w-full rounded-md border"
          />
        )}

        {promise.explanation && (
          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-medium text-muted-foreground">Verdict</h2>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{promise.explanation}</p>
            {promise.settlement?.mocked && (
              <p className="text-sm text-muted-foreground">
                Simulated: {formatUsdc(promise.settlement.amount)} USDC would {promise.settlement.outcome === "refund" ? "go back to the maker" : `go to ${promise.beneficiaryName}`}. Nothing was sent.
              </p>
            )}
          </section>
        )}

        {promise.trace.length > 0 && <AgentRun steps={promise.trace} />}
      </div>

      <aside className="flex flex-col gap-6 md:sticky md:top-8 md:self-start">
        {(!settled || needsOnchainSettle(promise)) && (
          <Panel title="Proof">
            {promise.proofType === "image" && (
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-muted-foreground">{promise.imageProof ? "Replace photo" : "Upload a photo or screenshot"}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  disabled={uploading || checking}
                  onChange={(event) => upload(event.target.files?.[0] ?? null)}
                  className="text-sm file:mr-3 file:rounded-md file:border file:bg-transparent file:px-2 file:py-1 file:text-sm file:text-foreground"
                />
                {uploadError && <span className="text-destructive">{uploadError}</span>}
              </label>
            )}
            <Button type="button" disabled={checking} onClick={() => onCheck(promise.id)} className="h-9 w-full">
              {checking ? `Checking${seconds > 0 ? ` · ${seconds}s` : "…"}` : needsOnchainSettle(promise) ? "Finish payout" : promise.verdict === "pending" ? "Check again" : "Check proof"}
            </Button>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </Panel>
        )}

        {canBack && (
          <Panel title="Back this promise" id="back">
            <p className="text-sm text-muted-foreground">Kept: your USDC comes back. Broken: it goes to {promise.beneficiaryName}. One signature, no gas.</p>
            <div className="flex gap-2">
              <Input aria-label="Amount in USDC" inputMode="decimal" value={backAmount} onChange={(e) => setBackAmount(e.target.value)} className="h-9 font-mono" />
              <Button type="button" variant="outline" disabled={Boolean(backStep)} onClick={back} className="h-9 shrink-0">
                {backStep ? "Backing…" : "Back with USDC"}
              </Button>
            </div>
            {backStep && <p aria-live="polite" className="text-sm text-muted-foreground">{backStep}</p>}
            {backError && <p role="alert" className="text-sm text-destructive">{backError}</p>}
          </Panel>
        )}

        {canExpire && !promise.settlement && (
          <Panel title="Expire">
            <p className="text-sm text-muted-foreground">Nobody settled this in time. Anyone can close it and refund everyone.</p>
            <Button type="button" variant="outline" disabled={expiring} onClick={expire} className="h-9 w-full">
              {expiring ? "Expiring…" : "Expire and refund"}
            </Button>
            {expireError && <p role="alert" className="text-sm text-destructive">{expireError}</p>}
          </Panel>
        )}

        {expired && <p className="text-sm text-muted-foreground">Expired. Everyone got their USDC back.</p>}

        <Panel title="Share">
          <Button type="button" variant="outline" onClick={share} className="h-9 w-full">{copied ? "Link copied" : "Copy link"}</Button>
        </Panel>
      </aside>
    </div>
  );
}

export function StatusDot({ label }: { label: StatusLabel }) {
  const color = label === "Kept" ? "bg-primary" : label === "Broken" ? "bg-destructive" : label === "Open" || label === "Checking" ? "bg-foreground" : label === "Check proof" || label === "Overdue" ? "bg-amber-400" : "bg-muted-foreground";
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span aria-hidden className={`size-2 rounded-full ${color} ${label === "Open" ? "bg-transparent ring-1 ring-foreground" : ""}`} />
      {label}
    </span>
  );
}

function KV({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

function Panel({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-8 flex-col gap-3 rounded-md border p-4">
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}

function AgentRun({ steps }: { steps: TraceStep[] }) {
  const shown = steps.filter((step) => step.tool !== "settle_stake" || !isMocked(step.result));
  if (shown.length === 0) return null;

  return (
    <details className="rounded-md border px-4 py-3">
      <summary className="cursor-pointer text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground">Agent log · {shown.length} steps</summary>
      <ol className="mt-3 flex flex-col gap-4">
        {shown.map((step, index) => {
          const summary = summaryOf(step.result);
          const facts = factsOf(step.result);
          return (
            <li key={`${step.tool}-${index}`} className="flex flex-col gap-2 text-sm">
              <p>
                <span className="text-muted-foreground">{index + 1}. </span>
                {TOOL_LABEL[step.tool] ?? step.tool}
                {step.error && <span className="ml-2 text-destructive">failed</span>}
              </p>
              {summary && <p>{summary}</p>}
              {txHashOf(step.result) && <a href={txUrl(txHashOf(step.result)!)} target="_blank" rel="noreferrer" className="font-mono text-xs underline underline-offset-4">{txHashOf(step.result)!.slice(0, 10)}…</a>}
              {facts.length > 0 && (
                <dl className="grid gap-1">
                  {facts.map((fact) => (
                    <div key={fact.label} className="grid grid-cols-[7.5rem_1fr] gap-2">
                      <dt className="text-muted-foreground">{fact.label}</dt>
                      <dd className="break-words">{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <details className="min-w-0">
                <summary className="cursor-pointer text-muted-foreground">Raw data</summary>
                <div className="mt-2 flex flex-col gap-2">
                  <TraceJson label="Called with" value={step.args} />
                  <TraceJson label="Response" value={step.result} />
                </div>
              </details>
            </li>
          );
        })}
      </ol>
    </details>
  );
}

function isMocked(result: unknown): boolean {
  return Boolean(result && typeof result === "object" && (result as { mocked?: unknown }).mocked !== false);
}

function txHashOf(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const hash = (result as { txHash?: unknown }).txHash;
  return typeof hash === "string" ? hash : null;
}

function TxLink({ label, hash }: { label: string; hash: string }) {
  return (
    <a href={txUrl(hash)} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-4 px-3 py-2 transition-colors duration-150 hover:bg-white/[0.03]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs">{hash.slice(0, 10)}…{hash.slice(-6)} ↗</span>
    </a>
  );
}

function TraceJson({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      <pre className="overflow-x-auto bg-background p-2 text-xs whitespace-pre-wrap break-words">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}
