import { createPublicClient, formatUnits, http, type Hex } from "viem";
import { chain, ESCROW_ADDRESS, escrowAbi } from "./escrow";
import type { ChainState, PromiseRecord } from "./types";

const STATUS: ChainState["status"][] = ["none", "open", "kept", "broken", "expired"];

export function toChainState(raw: { deadline: bigint; status: number; makerStake: bigint; backedTotal: bigint }, grace: bigint): ChainState {
  return {
    status: STATUS[raw.status] ?? "none",
    stakeUsdc: formatUnits(raw.makerStake, 6),
    backedUsdc: formatUnits(raw.backedTotal, 6),
    expiresAt: new Date(Number(raw.deadline + grace) * 1000).toISOString(),
  };
}

// Reads stake, backing and status from the escrow. If the RPC fails, the
// promise keeps whatever Redis has and `chain` stays unset.
export async function withChainState(promises: PromiseRecord[]): Promise<PromiseRecord[]> {
  const escrow = ESCROW_ADDRESS;
  const staked = promises.filter((p) => p.onchain?.escrowId);
  if (!escrow || staked.length === 0) return promises;
  try {
    const reader = createPublicClient({ chain, transport: http(process.env.BASE_SEPOLIA_RPC || undefined) });
    const [grace, rows] = await Promise.all([
      reader.readContract({ address: escrow, abi: escrowAbi, functionName: "gracePeriod" }),
      reader.multicall({
        allowFailure: false,
        contracts: staked.map((p) => ({ address: escrow, abi: escrowAbi, functionName: "getPromise" as const, args: [p.onchain!.escrowId as Hex] as const })),
      }),
    ]);
    const byId = new Map(staked.map((p, i) => [p.id, toChainState(rows[i], grace)]));
    return promises.map((p) => (byId.has(p.id) ? { ...p, chain: byId.get(p.id) } : p));
  } catch {
    return promises;
  }
}
