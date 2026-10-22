import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  parseEventLogs,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chain, ESCROW_ADDRESS, escrowAbi, STATUS_OPEN } from "@/lib/escrow";
import type { SettlementIntent, SettlementReceipt } from "@/lib/types";

function loadAccount() {
  const key = process.env.WALLET_PRIVATE_KEY;
  return key ? privateKeyToAccount(key as Hex) : null;
}

function requireAccount() {
  const account = loadAccount();
  if (!account) throw new Error("The agent has no wallet yet. Set WALLET_PRIVATE_KEY to a test wallet.");
  return account;
}

export interface StakeSettler {
  settle(intent: SettlementIntent): Promise<SettlementReceipt>;
}

export class MockStakeSettler implements StakeSettler {
  async settle(intent: SettlementIntent): Promise<SettlementReceipt> {
    const kept = intent.verdict === "kept";
    const to = kept ? intent.makerAddress : intent.beneficiaryAddress;
    const toLabel = kept ? "maker" : intent.beneficiaryName;
    const outcome = kept ? "refund" : "forfeit";
    return {
      id: `set_${crypto.randomUUID()}`,
      promiseId: intent.promiseId,
      mocked: true,
      network: "base-sepolia",
      asset: "USDC",
      amount: intent.amountUsdc,
      outcome,
      fromLabel: "mock-escrow",
      to,
      toLabel,
      txHash: null,
      createdAt: new Date().toISOString(),
      note: kept
        ? "Simulated settlement. No USDC was sent. This stake would come back to you."
        : `Simulated settlement. No USDC was sent. This stake would go to ${intent.beneficiaryName}.`,
    };
  }
}

export function publicClient() {
  return createPublicClient({ chain, transport: http(process.env.BASE_SEPOLIA_RPC || undefined) });
}

export class EscrowStakeSettler implements StakeSettler {
  async settle(intent: SettlementIntent): Promise<SettlementReceipt> {
    if (!intent.onchain || !ESCROW_ADDRESS) throw new Error("This promise has no stake in the escrow.");
    const account = requireAccount();
    const client = publicClient();
    const wallet = createWalletClient({ account, chain, transport: http(process.env.BASE_SEPOLIA_RPC || undefined) });
    const id = intent.onchain.escrowId;
    const kept = intent.verdict === "kept";

    const current = await client.readContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "getPromise", args: [id] });
    if (current.status !== STATUS_OPEN) throw new Error("The escrow says this stake is already closed. Nothing was sent.");

    const hash = await wallet.writeContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "settle", args: [id, kept] });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`Settlement transaction ${hash} reverted.`);

    const logs = parseEventLogs({ abi: escrowAbi, logs: receipt.logs, eventName: kept ? "Refunded" : "Forfeited" });
    const payouts = logs.map((log) =>
      log.eventName === "Refunded"
        ? { to: log.args.to, amount: formatUnits(log.args.amount, 6) }
        : { to: (log.args as { beneficiary: Address }).beneficiary, amount: formatUnits((log.args as { total: bigint }).total, 6) },
    );

    return {
      id: `set_${hash}`,
      promiseId: intent.promiseId,
      mocked: false,
      network: "base-sepolia",
      asset: "USDC",
      amount: intent.amountUsdc,
      outcome: kept ? "refund" : "forfeit",
      fromLabel: "escrow",
      to: kept ? intent.onchain.maker : intent.beneficiaryAddress,
      toLabel: kept ? "maker" : intent.beneficiaryName,
      txHash: hash,
      payouts,
      createdAt: new Date().toISOString(),
      note: kept ? "The escrow refunded the stake." : `The escrow paid the stake to ${intent.beneficiaryName}.`,
    };
  }
}

export function escrowReady(): boolean {
  return Boolean(ESCROW_ADDRESS && process.env.WALLET_PRIVATE_KEY);
}

export function settleStake(intent: SettlementIntent): Promise<SettlementReceipt> {
  const settler: StakeSettler = intent.onchain && escrowReady() ? new EscrowStakeSettler() : new MockStakeSettler();
  return settler.settle(intent);
}
