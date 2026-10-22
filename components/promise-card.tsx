"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PROOF_LABEL, VERDICT_LABEL, dueLabel, formatUsdc, formatWhen } from "@/lib/format";
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

function countdown(iso: string, now: number): string {
  const diff = new Date(iso).getTime() - now;
  if (Number.isNaN(diff)) return "";
  const past = diff < 0;
  const mins = Math.floor(Math.abs(diff) / 60_000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  const parts = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${Math.max(m, 1)}m`;
  return past ? `ended ${parts} ago` : `${parts} left`;
}

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

export function PromiseCard({
  promise,
  standalone,
  open,
  onToggle,
  checking,
  error,
  onCheck,
  onUploaded,
}: {
  promise: PromiseRecord;
  standalone?: boolean;
  open: boolean;
  onToggle: () => void;
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
  const ended = now > new Date(promise.deadline).getTime();
  const label = expired
    ? "Expired"
    : checking
      ? "Checking"
      : promise.verdict === "kept" || promise.verdict === "broken"
        ? VERDICT_LABEL[promise.verdict]
        : ended
          ? promise.verdict === "pending" ? "Overdue" : "Check proof"
          : promise.verdict ? VERDICT_LABEL[promise.verdict] : "Open";
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = `${window.location.origin}/p/${promise.id}`;
    try {
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) await navigator.share({ title: promise.description, url });
      else {
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

  return (
    <Card className="min-w-0 gap-0 py-0" aria-busy={checking}>
      <div className="flex min-w-0 items-stretch">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left hover:bg-muted/50"
      >
        <span className="min-w-0 flex-1 truncate font-medium">{promise.description}</span>
        <Badge variant="outline" className={STATUS_STYLE[label]}>{label}</Badge>
        <span className="hidden w-32 shrink-0 whitespace-nowrap text-right text-sm text-muted-foreground sm:inline">{countdown(promise.deadline, now)}</span>
        <span className="shrink-0 whitespace-nowrap text-right text-sm tabular-nums">{formatUsdc(String(Number(stake) + backed))} USDC</span>
        <span aria-hidden className="text-muted-foreground">{open ? "−" : "+"}</span>
      </button>
      {!standalone && (
        <button type="button" onClick={share} aria-label="Copy link to this promise" className="shrink-0 border-l px-3 text-xs text-muted-foreground hover:text-foreground">
          {copied ? "Copied" : "Share"}
        </button>
      )}
      </div>
      {open && (
      <CardContent className="flex flex-col gap-4 border-t px-4 py-4">
        <p className="text-sm text-muted-foreground">{PROOF_LABEL[promise.proofType]} proof · {countdown(promise.deadline, now)}</p>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <Meta label="On the line" value={`${formatUsdc(stake)} USDC${backed > 0 ? ` + ${formatUsdc(String(backed))} from backers` : ""}${chainState || promise.onchain ? "" : " (simulated)"}`} />
          <Meta label="Deadline" value={`${formatWhen(promise.deadline)} · ${dueLabel(promise.deadline)}`} />
          <Meta label="Proof" value={promise.target} />
          <Meta label="If broken, it goes to" value={promise.beneficiaryName} />
        </dl>

        {promise.onchain && <TxLink label="Stake" hash={promise.onchain.createTx} />}
        {promise.backings?.map((b) => (
          <TxLink key={b.creditTx} label={`Backed with ${formatUsdc(b.amountUsdc)} USDC`} hash={b.creditTx} />
        ))}

        {canBack && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Back this promise</p>
            <p className="text-sm text-muted-foreground">Add test USDC to cheer them on. You sign once and pay no gas. If they keep it you get it back, if not it goes to {promise.beneficiaryName}.</p>
            <div className="flex flex-wrap gap-2">
              <Input
                aria-label="Backing in USDC"
                inputMode="decimal"
                value={backAmount}
                onChange={(e) => setBackAmount(e.target.value)}
                className="h-11 w-28"
              />
              <Button type="button" variant="outline" disabled={Boolean(backStep)} onClick={back} className="h-11">
                {backStep ? "Backing…" : "Back with USDC"}
              </Button>
            </div>
            {backStep && <p aria-live="polite" className="text-sm text-muted-foreground">{backStep}</p>}
            {backError && <p role="alert" className="text-sm text-destructive">{backError}</p>}
          </div>
        )}

        {expired && <p className="border px-3 py-2 text-sm">Expired. Nobody checked it in time, so everyone got their USDC back.</p>}

        {canExpire && !promise.settlement && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">Nobody settled this in time. Anyone can close it and send everyone's USDC back.</p>
            <Button type="button" variant="outline" disabled={expiring} onClick={expire} className="h-11 w-full sm:w-auto">
              {expiring ? "Expiring…" : "Expire and refund"}
            </Button>
            {expireError && <p role="alert" className="text-sm text-destructive">{expireError}</p>}
          </div>
        )}

        {promise.proofType === "image" && promise.imageProof && (
          <img
            src={`/api/promises/${promise.id}/proof?v=${encodeURIComponent(promise.imageProof.uploadedAt)}`}
            alt={promise.imageProof.fileName}
            className="max-h-48 w-full border object-contain"
          />
        )}

        {promise.proofType === "image" && !settled && (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">{promise.imageProof ? "Replace photo" : "Add your photo"}</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              disabled={uploading || checking}
              onChange={(event) => upload(event.target.files?.[0] ?? null)}
              className="text-base file:mr-3 file:text-sm"
            />
            <span className="text-muted-foreground">JPEG, PNG, WebP, or GIF. Large photos are shrunk first.</span>
            {uploadError && <span className="text-destructive">{uploadError}</span>}
          </label>
        )}

        {(!settled || needsOnchainSettle(promise)) && (
          <Button type="button" disabled={(settled && !needsOnchainSettle(promise)) || checking} onClick={() => onCheck(promise.id)} className="h-11 w-full sm:w-auto">
            {checking ? "Checking…" : needsOnchainSettle(promise) ? "Finish payout" : promise.verdict === "pending" ? "Check again" : "Check my proof"}
          </Button>
        )}

        {checking && (
          <p aria-live="polite" className="border px-3 py-2 text-sm">
            Swappy is checking this now{seconds > 0 ? ` (${seconds}s)` : ""}. This usually takes under a minute.
          </p>
        )}

        {error && (
          <p role="alert" className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {promise.explanation && (
          <div className="flex flex-col gap-1 text-sm">
            <p className="font-medium">Swappy&apos;s verdict</p>
            <p className="leading-relaxed whitespace-pre-wrap">{promise.explanation}</p>
          </div>
        )}

        {promise.settlement && !promise.settlement.mocked && (
          <div className="flex flex-col gap-1 border px-3 py-3 text-sm">
            <p className="font-medium">Paid out on Base Sepolia</p>
            <p>
              {promise.settlement.outcome === "refund"
                ? `${formatUsdc(promise.settlement.amount)} USDC went back to you.`
                : `${formatUsdc(promise.settlement.amount)} USDC went to ${promise.beneficiaryName}.`}
            </p>
            {promise.settlement.txHash && <TxLink label="Settlement" hash={promise.settlement.txHash} />}
          </div>
        )}

        {promise.settlement?.mocked && (
          <div className="flex flex-col gap-1 border px-3 py-3 text-sm">
            <p className="font-medium">Simulated payout</p>
            <p>
              {promise.settlement.outcome === "refund"
                ? `${formatUsdc(promise.settlement.amount)} USDC would come back to you.`
                : `${formatUsdc(promise.settlement.amount)} USDC would go to ${promise.beneficiaryName}.`}
            </p>
            <p className="text-muted-foreground">No money was sent.</p>
          </div>
        )}

        {promise.trace.length > 0 && <AgentRun steps={promise.trace} />}
      </CardContent>
      )}
    </Card>
  );
}

function AgentRun({ steps }: { steps: TraceStep[] }) {
  const shown = steps.filter((step) => step.tool !== "settle_stake" || !isMocked(step.result));
  if (shown.length === 0) return null;

  return (
    <details className="border px-3 py-3">
      <summary className="cursor-pointer text-sm font-medium">What Swappy did ({shown.length} steps)</summary>
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
              {txHashOf(step.result) && <TxLink label="Transaction" hash={txHashOf(step.result)!} />}
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
    <p className="text-sm">
      <span className="text-muted-foreground">{label}: </span>
      <a href={txUrl(hash)} target="_blank" rel="noreferrer" className="font-mono break-all underline">
        {hash.slice(0, 10)}…{hash.slice(-8)}
      </a>{" "}
      on BaseScan
    </p>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
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
