import { getAddress, isHash, parseEventLogs, type Hex } from "viem";
import { publicClient } from "@/agent/wallet";
import { ESCROW_ADDRESS, escrowAbi, escrowId, STATUS_OPEN, usdcUnits } from "@/lib/escrow";
import { getPromise, savePromise } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const escrow = ESCROW_ADDRESS;
  if (!escrow) return Response.json({ error: "The escrow is not configured." }, { status: 400 });

  const body = (await req.json().catch(() => null)) as { txHash?: string } | null;
  const txHash = body?.txHash;
  if (!txHash || !isHash(txHash)) return Response.json({ error: "Send the create transaction hash." }, { status: 400 });

  const promise = await getPromise(id);
  if (!promise) return Response.json({ error: "Promise not found." }, { status: 404 });
  if (promise.onchain) return Response.json(promise);

  const client = publicClient();
  const receipt = await client.waitForTransactionReceipt({ hash: txHash as Hex, timeout: 60_000 }).catch(() => null);
  if (!receipt || receipt.status !== "success") {
    return Response.json({ error: "That transaction did not succeed on Base Sepolia." }, { status: 400 });
  }

  const key = escrowId(id);
  const created = parseEventLogs({ abi: escrowAbi, logs: receipt.logs, eventName: "PromiseCreated" }).find(
    (log) => getAddress(log.address) === getAddress(escrow) && log.args.id === key,
  );
  if (!created) return Response.json({ error: "That transaction did not create this promise in the escrow." }, { status: 400 });

  let onchain = await client.readContract({ address: escrow, abi: escrowAbi, functionName: "getPromise", args: [key] });
  for (let i = 0; i < 10 && onchain.status !== STATUS_OPEN; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    onchain = await client.readContract({ address: escrow, abi: escrowAbi, functionName: "getPromise", args: [key] });
  }
  if (
    onchain.status !== STATUS_OPEN ||
    getAddress(onchain.maker) !== promise.makerAddress ||
    getAddress(onchain.beneficiary) !== promise.beneficiaryAddress ||
    onchain.makerStake !== usdcUnits(promise.stakeUsdc)
  ) {
    return Response.json({ error: "The escrow does not match this promise." }, { status: 400 });
  }

  const saved = await savePromise(id, { onchain: { escrowId: key, createTx: txHash as Hex, maker: promise.makerAddress } });
  return Response.json(saved);
}
