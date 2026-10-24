import { assertBackable, BackingError, creditWalletBacking } from "@/agent/backing";
import { ESCROW_ADDRESS } from "@/lib/escrow";
import {
  backingRequirements,
  decodePayment,
  matchesRequirements,
  parseBackingAmount,
  settleWithFacilitator,
  verifyWithFacilitator,
} from "@/lib/x402";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function fail(err: unknown, fallback: string) {
  const status = err instanceof BackingError ? err.status : 502;
  return Response.json({ error: err instanceof Error ? err.message : fallback }, { status });
}

// Two ways to back a promise:
// 1. x402: POST ?amount=0.5 returns 402 with payment requirements. Retry with an
//    X-PAYMENT header; the facilitator moves the USDC into the escrow and Swappy credits it.
// 2. { txHash }: the backer already sent USDC to the escrow from their wallet.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const header = req.headers.get("x-payment");
  const body = header ? null : ((await req.json().catch(() => null)) as { amountUsdc?: string; txHash?: string } | null);

  if (body?.txHash) {
    try {
      return Response.json(await creditWalletBacking(id, body.txHash));
    } catch (err) {
      return fail(err, "Could not credit the backing.");
    }
  }

  const amount = parseBackingAmount(url.searchParams.get("amount") ?? body?.amountUsdc ?? "");
  if (!amount) return Response.json({ error: "Pick an amount between 0.01 and 5 USDC, e.g. ?amount=0.5" }, { status: 400 });

  try {
    await assertBackable(id);
  } catch (err) {
    return fail(err, "This promise can't be backed.");
  }

  const requirements = backingRequirements({ amountUsdc: amount, resource: url.toString(), payTo: ESCROW_ADDRESS! });
  const payment = decodePayment(header);
  if (!payment || !matchesRequirements(payment, requirements)) {
    return Response.json(
      { x402Version: 1, error: header ? "Payment does not match this request." : "X-PAYMENT header is required", accepts: [requirements] },
      { status: 402 },
    );
  }

  const verified = await verifyWithFacilitator(payment, requirements).catch((err: Error) => ({ isValid: false, invalidReason: err.message }));
  if (!verified.isValid) {
    return Response.json({ x402Version: 1, error: verified.invalidReason || "Payment is not valid.", accepts: [requirements] }, { status: 402 });
  }

  const settled = await settleWithFacilitator(payment, requirements).catch((err: Error) => ({
    success: false as const,
    errorReason: err.message,
    transaction: undefined,
    network: undefined,
    payer: undefined,
  }));
  if (!settled.success || !settled.transaction) {
    return Response.json({ x402Version: 1, error: settled.errorReason || "Payment did not settle.", accepts: [requirements] }, { status: 402 });
  }

  const paymentResponse = btoa(
    JSON.stringify({ success: true, transaction: settled.transaction, network: settled.network ?? requirements.network, payer: settled.payer }),
  );
  try {
    const promise = await creditWalletBacking(id, settled.transaction, "x402");
    return Response.json(promise, { headers: { "X-PAYMENT-RESPONSE": paymentResponse } });
  } catch (err) {
    // The USDC is in the escrow even if crediting failed; the payment tx can be credited again with { txHash }.
    const res = fail(err, "Paid, but the backing was not credited yet.");
    const data = await res.json();
    return Response.json({ ...data, paymentTx: settled.transaction }, { status: res.status, headers: { "X-PAYMENT-RESPONSE": paymentResponse } });
  }
}
