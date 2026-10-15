import { judgePromise } from "@/agent/agent";
import { settleStake } from "@/agent/wallet";
import { beginCheck, savePromise } from "@/lib/store";
import type { PromiseUpdate, TraceStep } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const started = await beginCheck(id);
  if (started.state === "missing") return Response.json({ error: "Promise not found." }, { status: 404 });
  if (started.state === "busy") return Response.json({ error: "This promise is already being checked." }, { status: 409 });
  if (started.state === "settled") return Response.json(started.promise);

  try {
    const judgment = await judgePromise(started.promise);
    const trace: TraceStep[] = [...judgment.steps];
    const patch: PromiseUpdate = {
      verdict: judgment.verdict,
      explanation: judgment.explanation,
      decidedBy: judgment.decidedBy,
      checkedAt: new Date().toISOString(),
      checkingStartedAt: null,
      status: judgment.verdict === "pending" ? "open" : "resolved",
      settlement: null,
      trace,
    };

    if (judgment.verdict === "kept" || judgment.verdict === "broken") {
      const settlement = await settleStake({
        promiseId: id,
        verdict: judgment.verdict,
        amountUsdc: started.promise.stakeUsdc,
        makerAddress: started.promise.makerAddress,
        beneficiaryName: started.promise.beneficiaryName,
        beneficiaryAddress: started.promise.beneficiaryAddress,
      });
      trace.push({
        tool: "settle_stake",
        args: { verdict: judgment.verdict, amountUsdc: started.promise.stakeUsdc, to: settlement.to, outcome: settlement.outcome },
        result: settlement,
      });
      patch.settlement = settlement;
      patch.trace = trace;
    }

    const saved = await savePromise(id, patch);
    return Response.json(saved);
  } catch (err) {
    await savePromise(id, { status: "open", checkingStartedAt: null }).catch(() => undefined);
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
