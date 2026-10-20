import { sendFromAgent } from "@/agent/transfer";
import { txUrl } from "@/lib/escrow";
import { validateTransfer } from "@/lib/transfer";

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

  try {
    const { hash, from } = await sendFromAgent(checked.transfer);
    return Response.json({ hash, from, url: txUrl(hash), transfer: checked.transfer });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "The transfer failed." }, { status: 400 });
  }
}
