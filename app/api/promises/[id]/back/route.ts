/**
 * WEEK 3 STUB
 *
 * Friends back or raise a stake with an x402 micropayment.
 * The live version should:
 *   1. Answer 402 with a price, asset, and payTo.
 *   2. Accept a signed X-PAYMENT header via verifyPayment.
 *   3. Increase the promise stake.
 * payAndFetch in agent/wallet.ts is the client side of that handshake.
 * This route accepts nothing and moves no funds.
 */
import { backPromiseWithX402 } from "@/agent/wallet";
import { getPromise } from "@/lib/store";
import { parseStake } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const promise = await getPromise(id);
  if (!promise) return Response.json({ error: "Promise not found." }, { status: 404 });

  let amount = "1.00";
  try {
    const body = (await req.json()) as { amountUsdc?: string };
    if (body?.amountUsdc) {
      const parsed = parseStake(body.amountUsdc);
      if (!parsed) return Response.json({ error: "Amount must be a positive USDC value." }, { status: 400 });
      amount = parsed;
    }
  } catch {
    // An empty body still returns the stub.
  }

  const result = await backPromiseWithX402({ promiseId: id, amountUsdc: amount });
  return Response.json(result);
}
