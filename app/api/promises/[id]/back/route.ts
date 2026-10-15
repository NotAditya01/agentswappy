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
    // ignore malformed body
  }

  const result = await backPromiseWithX402({ promiseId: id, amountUsdc: amount });
  return Response.json(result);
}
