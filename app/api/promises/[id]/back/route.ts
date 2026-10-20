import { BackingError, creditWalletBacking } from "@/agent/backing";
import { backPromiseWithX402 } from "@/agent/wallet";
import { getPromise } from "@/lib/store";
import { parseStake } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { amountUsdc?: string; txHash?: string } | null;

  // A backer who sent USDC from their own wallet.
  if (body?.txHash) {
    try {
      return Response.json(await creditWalletBacking(id, body.txHash));
    } catch (err) {
      const status = err instanceof BackingError ? err.status : 502;
      return Response.json({ error: err instanceof Error ? err.message : "Could not credit the backing." }, { status });
    }
  }

  const promise = await getPromise(id);
  if (!promise) return Response.json({ error: "Promise not found." }, { status: 404 });

  let amount = "1.00";
  if (body?.amountUsdc) {
    const parsed = parseStake(body.amountUsdc);
    if (!parsed) return Response.json({ error: "Amount must be a positive USDC value." }, { status: 400 });
    amount = parsed;
  }

  const result = await backPromiseWithX402({ promiseId: id, amountUsdc: amount });
  return Response.json(result);
}
