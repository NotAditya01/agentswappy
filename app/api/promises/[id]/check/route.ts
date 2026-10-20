import { judgePromise } from "@/agent/agent";
import { settleStake } from "@/agent/wallet";
import { needsOnchainSettle, STAKE_NOT_CONFIRMED, stakeUnconfirmed } from "@/lib/stake";
import { beginCheck, savePromise } from "@/lib/store";
import type { PromiseRecord, PromiseUpdate, TraceStep } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function settle(promise: PromiseRecord, verdict: "kept" | "broken", trace: TraceStep[]) {
  const settlement = await settleStake({
    promiseId: promise.id,
    onchain: promise.onchain ?? null,
    verdict,
    amountUsdc: promise.stakeUsdc,
    makerAddress: promise.makerAddress,
    beneficiaryName: promise.beneficiaryName,
    beneficiaryAddress: promise.beneficiaryAddress,
  });
  const steps = trace.filter((step) => step.tool !== "settle_stake");
  steps.push({
    tool: "settle_stake",
    args: { verdict, amountUsdc: promise.stakeUsdc, to: settlement.to, outcome: settlement.outcome, escrowId: promise.onchain?.escrowId ?? null },
    result: settlement,
  });
  return { settlement, trace: steps };
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const started = await beginCheck(id);
  if (started.state === "missing") return Response.json({ error: "Promise not found." }, { status: 404 });
  if (started.state === "busy") return Response.json({ error: "This promise is already being checked." }, { status: 409 });

  if (started.state === "settled") {
    const promise = started.promise;
    if (!needsOnchainSettle(promise)) return Response.json(promise);
    try {
      const done = await settle(promise, promise.verdict as "kept" | "broken", promise.trace);
      return Response.json(await savePromise(id, done));
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  if (stakeUnconfirmed(started.promise)) {
    await savePromise(id, { status: "open", checkingStartedAt: null });
    return Response.json({ error: STAKE_NOT_CONFIRMED }, { status: 409 });
  }

  try {
    const judgment = await judgePromise(started.promise);
    const patch: PromiseUpdate = {
      verdict: judgment.verdict,
      explanation: judgment.explanation,
      decidedBy: judgment.decidedBy,
      checkedAt: new Date().toISOString(),
      checkingStartedAt: null,
      status: judgment.verdict === "pending" ? "open" : "resolved",
      settlement: null,
      trace: [...judgment.steps],
    };

    if (judgment.verdict === "kept" || judgment.verdict === "broken") {
      Object.assign(patch, await settle(started.promise, judgment.verdict, judgment.steps));
    }

    const saved = await savePromise(id, patch);
    return Response.json(saved);
  } catch (err) {
    await savePromise(id, { status: "open", checkingStartedAt: null }).catch(() => undefined);
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
