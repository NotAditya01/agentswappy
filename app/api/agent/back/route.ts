import { agentBack, AgentPayError, overAgentBackingCap, type PayStep } from "@/agent/x402-pay";
import { ESCROW_ADDRESS } from "@/lib/escrow";
import { clientIp, takeSendSlot } from "@/lib/ratelimit";
import { AGENT_CAP } from "@/lib/transfer";
import { parseBackingAmount } from "@/lib/x402";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Swappy backs a promise from its own wallet over x402. Only runs after the user pressed Confirm.
// Streams one JSON line per step so the UI shows 402 -> signed -> settled as it happens.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { promiseId?: string; amountUsdc?: string; confirmed?: boolean } | null;
  if (body?.confirmed !== true) return Response.json({ error: "Confirm the backing first. Nothing was paid." }, { status: 400 });
  const promiseId = String(body.promiseId ?? "").trim();
  const amountUsdc = parseBackingAmount(body.amountUsdc);
  if (!promiseId) return Response.json({ error: "Which promise?" }, { status: 400 });
  if (!amountUsdc) return Response.json({ error: "Pick an amount between 0.01 and 2 USDC." }, { status: 400 });
  if (overAgentBackingCap(amountUsdc)) {
    return Response.json({ error: `Swappy pays at most ${AGENT_CAP.USDC} USDC per backing. Nothing was paid.` }, { status: 400 });
  }
  if (!ESCROW_ADDRESS) return Response.json({ error: "The escrow is not configured on this server." }, { status: 503 });

  let slot;
  try {
    slot = await takeSendSlot(clientIp(req));
  } catch {
    return Response.json({ error: "Could not check the send limit, so nothing was paid. Try again soon." }, { status: 503 });
  }
  if (!slot.ok) return Response.json({ error: `${slot.error} Nothing was paid.` }, { status: 429 });

  const origin = process.env.X402_SELF_ORIGIN || new URL(req.url).origin;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: PayStep | { step: "error"; error: string; paymentTx?: string }) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      try {
        await agentBack({ promiseId, amountUsdc, origin, escrow: ESCROW_ADDRESS!, onStep: send });
      } catch (err) {
        const paymentTx = err instanceof AgentPayError ? err.paymentTx : undefined;
        send({ step: "error", error: err instanceof Error ? err.message : "The payment failed.", paymentTx });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}
