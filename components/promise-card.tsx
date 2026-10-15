"use client";

import { useState } from "react";
import { ChevronRight, ImagePlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PROOF_LABEL, VERDICT_LABEL, dueLabel, formatUsdc, formatWhen, shortAddress } from "@/lib/format";
import type { PromiseRecord, Verdict } from "@/lib/types";
import { cn } from "@/lib/utils";

function verdictVariant(verdict: Verdict | null): "default" | "destructive" | "outline" | "secondary" {
  if (verdict === "kept") return "default";
  if (verdict === "broken") return "destructive";
  if (verdict === "pending") return "outline";
  return "secondary";
}

export function PromiseCard({
  promise,
  checking,
  stub,
  onCheck,
  onBack,
  onUploaded,
}: {
  promise: PromiseRecord;
  checking: boolean;
  stub?: string;
  onCheck: (id: string) => void;
  onBack: (id: string) => void;
  onUploaded: () => Promise<void>;
}) {
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const settled = promise.verdict === "kept" || promise.verdict === "broken";
  const label = promise.verdict ? VERDICT_LABEL[promise.verdict] : promise.status === "checking" || checking ? "Checking" : "Open";

  async function upload(file: File | null) {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const body = new FormData();
      body.append("image", file);
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
    <Card className="min-w-0">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={verdictVariant(promise.verdict)} className="font-mono uppercase">
            {label}
          </Badge>
          <Badge variant="outline" className="font-mono uppercase">
            {PROOF_LABEL[promise.proofType]}
          </Badge>
          <span className="ml-auto font-mono text-sm">{formatUsdc(promise.stakeUsdc)} USDC</span>
        </div>
        <p className="text-lg font-bold tracking-tight">{promise.description}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Meta label="Target" value={promise.target} />
          <Meta label="Deadline" value={`${formatWhen(promise.deadline)} · ${dueLabel(promise.deadline)}`} />
          <Meta label="Beneficiary" value={`${promise.beneficiaryName} · ${shortAddress(promise.beneficiaryAddress)}`} title={promise.beneficiaryAddress} />
          <Meta label="Refund to" value={shortAddress(promise.makerAddress)} title={promise.makerAddress} />
        </dl>

        {promise.proofType === "image" && promise.imageProof && (
          <img
            src={`/api/promises/${promise.id}/proof?v=${encodeURIComponent(promise.imageProof.uploadedAt)}`}
            alt={promise.imageProof.fileName}
            className="max-h-56 border object-contain"
          />
        )}

        {promise.proofType === "image" && !settled && (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
              <ImagePlus className="size-3.5" /> {promise.imageProof ? "Replace photo" : "Upload photo"}
            </span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              disabled={uploading}
              onChange={(event) => upload(event.target.files?.[0] ?? null)}
              className="font-mono text-xs"
            />
            {uploadError && <span className="text-destructive">{uploadError}</span>}
          </label>
        )}

        {promise.explanation && (
          <blockquote className="border-l-2 border-primary bg-muted px-3 py-2 text-sm whitespace-pre-wrap">{promise.explanation}</blockquote>
        )}
        {promise.decidedBy && (
          <p className="font-mono text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
            {promise.decidedBy === "agent" ? "Verdict written by the agent" : "Verdict follows the proof checker"}
          </p>
        )}

        {promise.settlement && (
          <div className={cn("flex flex-col gap-1 border px-3 py-2", promise.settlement.outcome === "refund" ? "border-primary" : "border-destructive")}>
            <p className="font-mono text-[11px] tracking-[0.06em] uppercase">
              <span className={promise.settlement.outcome === "refund" ? "text-primary" : "text-destructive"}>
                {promise.settlement.outcome === "refund" ? "Refund" : "Forfeit"}
              </span>
              <span className="ml-2 text-muted-foreground">Mock · Base Sepolia · no transaction</span>
            </p>
            <p className="font-medium">
              {formatUsdc(promise.settlement.amount)} USDC → {promise.settlement.toLabel} ({shortAddress(promise.settlement.to)})
            </p>
            <p className="text-sm text-muted-foreground">{promise.settlement.note}</p>
          </div>
        )}

        {promise.trace.length > 0 && (
          <Collapsible defaultOpen className="border">
            <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-xs hover:bg-muted">
              <ChevronRight className="size-3.5 transition-transform group-data-[panel-open]:rotate-90" />
              <span className="uppercase text-muted-foreground">Reasoning trace</span>
              <span className="text-primary">{promise.trace.length} steps</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-3 border-t px-3 py-3">
              {promise.trace.map((step, index) => (
                <div key={`${step.tool}-${index}`} className="flex flex-col gap-2 font-mono text-xs">
                  <p>
                    <span className="text-muted-foreground uppercase">Tool </span>
                    <span className="text-primary">{step.tool}</span>
                    {step.error && <span className="ml-2 text-destructive">failed</span>}
                  </p>
                  <TraceJson label="Input" value={step.args} />
                  <TraceJson label="Output" value={step.result} />
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}

        {stub && <p className="border border-dashed px-3 py-2 text-sm text-muted-foreground">{stub}</p>}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button type="button" disabled={settled || checking} onClick={() => onCheck(promise.id)} className="font-mono tracking-wider uppercase">
          {checking ? "Checking..." : settled ? "Settled" : promise.verdict === "pending" ? "Check again" : "Check proof"}
        </Button>
        <Button type="button" variant="outline" onClick={() => onBack(promise.id)} className="font-mono tracking-wider uppercase">
          Back stake
        </Button>
      </CardFooter>
    </Card>
  );
}

function Meta({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-0" title={title}>
      <dt className="font-mono text-[11px] tracking-[0.06em] text-muted-foreground uppercase">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
}

function TraceJson({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="mb-1 text-muted-foreground uppercase">{label}</p>
      <pre className="max-h-64 overflow-auto bg-background p-2 whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}
