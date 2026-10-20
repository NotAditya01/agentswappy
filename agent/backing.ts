import { createWalletClient, formatUnits, http, isHash, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { findBackingTransfer } from "@/lib/backing";
import { chain, ESCROW_ADDRESS, escrowAbi, STATUS_OPEN, USDC_ADDRESS } from "@/lib/escrow";
import { getPromise, savePromise } from "@/lib/store";
import type { PromiseRecord } from "@/lib/types";
import { publicClient } from "./wallet";

export class BackingError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

// The backer already sent USDC to the escrow. The agent checks that transfer and credits it to the promise.
export async function creditWalletBacking(promiseId: string, txHash: string): Promise<PromiseRecord> {
  const escrow = ESCROW_ADDRESS;
  const key = process.env.WALLET_PRIVATE_KEY;
  if (!escrow || !key) throw new BackingError("The escrow is not configured on this server.");
  if (!isHash(txHash)) throw new BackingError("Send the USDC transfer hash.");

  const promise = await getPromise(promiseId);
  if (!promise) throw new BackingError("Promise not found.", 404);
  if (!promise.onchain) throw new BackingError("This promise has no stake in the escrow.");
  if (promise.backings?.some((b) => b.txHash.toLowerCase() === txHash.toLowerCase())) return promise;

  const client = publicClient();
  const receipt = await client.waitForTransactionReceipt({ hash: txHash as Hex, timeout: 60_000 }).catch(() => null);
  if (!receipt || receipt.status !== "success") throw new BackingError("That transfer did not succeed on Base Sepolia.");
  const sent = findBackingTransfer(receipt.logs, USDC_ADDRESS, escrow);
  if (!sent) throw new BackingError("That transaction did not send USDC to the escrow.");

  const id = promise.onchain.escrowId as Hex;
  const onchain = await client.readContract({ address: escrow, abi: escrowAbi, functionName: "getPromise", args: [id] });
  if (onchain.status !== STATUS_OPEN || Number(onchain.deadline) * 1000 <= Date.now()) {
    throw new BackingError("This promise is closed in the escrow, so the backing can't be credited. Ask Swappy's owner to return it.");
  }

  const account = privateKeyToAccount(key as Hex);
  const wallet = createWalletClient({ account, chain, transport: http(process.env.BASE_SEPOLIA_RPC || undefined) });
  const creditTx = await wallet.writeContract({
    address: escrow,
    abi: escrowAbi,
    functionName: "creditBacking",
    args: [id, sent.from, sent.value, txHash as Hex],
  });
  const credited = await client.waitForTransactionReceipt({ hash: creditTx });
  if (credited.status !== "success") throw new BackingError(`Crediting the backing reverted. Tx ${creditTx}`, 502);

  const backing = { backer: sent.from, amountUsdc: formatUnits(sent.value, 6), txHash, creditTx, at: new Date().toISOString() };
  const saved = await savePromise(promiseId, { backings: [...(promise.backings ?? []), backing] });
  return saved ?? promise;
}
