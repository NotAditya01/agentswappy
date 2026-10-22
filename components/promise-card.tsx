"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PROOF_LABEL, VERDICT_LABEL, dueLabel, formatUsdc, formatWhen } from "@/lib/format";
import { txUrl } from "@/lib/escrow";
import { backWithX402, expireOnchain } from "@/lib/fund";
import { Input } from "@/components/ui/input";
import { walletErrorMessage } from "@/lib/wallet-error";
import { useWallet } from "@/components/wallet-provider";
import { needsOnchainSettle } from "@/lib/stake";
import { shrinkPhoto } from "@/lib/shrink";
import type { PromiseRecord, TraceStep, Verdict } from "@/lib/types";


const TOOL_LABEL: Record<string, string> = {
  check_github_commits: "Looked up GitHub commits",
  check_image_proof: "Looked at the photo",
  check_strava_activity: "Checked Strava",
  record_verdict: "Wrote the verdict",
  settle_stake: "Settled the stake",
};

function verdictVariant(verdict: Verdict | null): "default" | "destructive" | "outline" | "secondary" {
  if (verdict === "kept") return "default";
  if (verdict === "broken") return "destructive";
  if (verdict === "pending") return "outline";
  return "secondary";
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
  if (row.connected === false) facts.push({ label: "Strava", value: "Not connected" });
  if (row.sentToVision === false) facts.push({ label: "Photo", value: "Not sent" });
  return facts;
}

export function PromiseCard({
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
  const label = expired ? "Expired" : promise.verdict ? VERDICT_LABEL[promise.verdict] : checking ? "Checking" : "Open";
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
    <Card className="min-w-0" aria-busy={checking}>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={verdictVariant(promise.verdict)}>{label}</Badge>
          <Badge variant="outline">{PROOF_LABEL[promise.proofType]}</Badge>
          <span className="ml-auto text-sm">{formatUsdc(stake)} USDC</span>
        </div>
        <h3 className="text-base font-medium leading-snug break-words">{promise.description}</h3>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <Meta label="Proof" value={promise.target} />
          <Meta label="Deadline" value={`${formatWhen(promise.deadline)} · ${dueLabel(promise.deadline)}`} />
          <Meta label="If broken, it goes to" value={promise.beneficiaryName} />
          <Meta label="Stake" value={`${formatUsdc(stake)} USDC, ${chainState ? `${chainState.status === "open" ? "locked in escrow" : chainState.status} (read on-chain)` : promise.onchain ? "locked in escrow" : "simulated"}`} />
          {backed > 0 && <Meta label="Backed by others" value={`${formatUsdc(String(backed))} USDC`} />}
        </dl>

        {promise.onchain && <TxLink label="Stake locked" hash={promise.onchain.createTx} />}
        {promise.backings?.map((b) => (
          <TxLink key={b.creditTx} label={`Backed with ${formatUsdc(b.amountUsdc)} USDC`} hash={b.creditTx} />
        ))}

        {canBack && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">Back this promise with x402. You sign once, no gas. Kept: you get it back. Broken: it goes to {promise.beneficiaryName}.</p>
            <div className="flex gap-2">
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
            {backStep && <p className="text-sm text-muted-foreground">{backStep}</p>}
            {backError && <p className="text-sm text-destructive">{backError}</p>}
          </div>
        )}

        {expired && <p className="border px-3 py-2 text-sm">Expired on-chain. The stake and any backing went back to whoever put it in.</p>}

        {canExpire && !promise.settlement && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">Swappy missed the grace window. Anyone can expire this and refund everyone.</p>
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
            className="max-h-64 w-full border object-contain"
          />
        )}

        {promise.proofType === "image" && !settled && (
          <label className="flex flex-col gap-1.5 text-sm">
            <span>{promise.imageProof ? "Replace photo" : "Add a photo"}</span>
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

        <div className="flex flex-col gap-3">
          <div>
            <p className="text-sm text-muted-foreground">Step 3</p>
            <p className="font-medium">Check proof</p>
          </div>
          <Button type="button" disabled={(settled && !needsOnchainSettle(promise)) || checking} onClick={() => onCheck(promise.id)} className="h-11 w-full sm:w-auto">
            {checking ? "Checking…" : needsOnchainSettle(promise) ? "Settle in escrow" : settled ? "Checked" : promise.verdict === "pending" ? "Check again" : "Check proof"}
          </Button>
        </div>

        {checking && (
          <p aria-live="polite" className="border px-3 py-2 text-sm">
            Swappy is checking this now{seconds > 0 ? ` (${seconds}s)` : ""}. It calls a tool, reads the result, and writes a verdict.
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
            <p className="font-medium">Settled on Base Sepolia</p>
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
            <p className="font-medium">Simulated settlement</p>
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
    </Card>
  );
}

function AgentRun({ steps }: { steps: TraceStep[] }) {
  const shown = steps.filter((step) => step.tool !== "settle_stake" || !isMocked(step.result));
  if (shown.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 border px-3 py-3">
      <p className="text-sm font-medium">What Swappy did</p>
      <ol className="flex flex-col gap-4">
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
              <p className="font-mono text-xs text-muted-foreground break-all">{step.tool}</p>
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
              <details open className="min-w-0">
                <summary className="cursor-pointer text-muted-foreground">Tool call and response</summary>
                <div className="mt-2 flex flex-col gap-2">
                  <TraceJson label="Called with" value={step.args} />
                  <TraceJson label="Response" value={step.result} />
                </div>
              </details>
            </li>
          );
        })}
      </ol>
    </div>
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
      <pre className="max-h-48 overflow-auto bg-background p-2 text-xs whitespace-pre-wrap break-words">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}
