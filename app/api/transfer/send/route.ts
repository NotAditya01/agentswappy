import { sendFromAgent } from "@/agent/transfer";
import { txUrl } from "@/lib/escrow";
import { clientIp, takeSendSlot } from "@/lib/ratelimit";
import { overAgentCap, validateTransfer } from "@/lib/transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Sends from the agent wallet. Only runs after the user pressed Confirm on the review card.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (body?.confirmed !== true) {
    return Response.json({ error: "Confirm the transfer first. Nothing was sent." }, { status: 400 });
  }
  const checked = validateTransfer({ token: body.token, amount: body.amount, to: body.to, network: body.network });
  if (!checked.ok) return Response.json({ error: checked.error }, { status: 400 });
  if (overAgentCap(checked.transfer)) {
    return Response.json({ error: "That is over the agent wallet's per-transfer cap. Nothing was sent." }, { status: 400 });
  }

  let slot;
  try {
    slot = await takeSendSlot(clientIp(req));
  } catch {
    return Response.json({ error: "Could not check the send limit, so nothing was sent. Try again soon." }, { status: 503 });
  }
  if (!slot.ok) return Response.json({ error: `${slot.error} Nothing was sent.` }, { status: 429 });

  try {
    const { hash, from } = await sendFromAgent(checked.transfer);
    return Response.json({ hash, from, url: txUrl(hash), transfer: checked.transfer });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "The transfer failed." }, { status: 400 });
  }
}
