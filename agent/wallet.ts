import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  parseEventLogs,
  verifyMessage,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chain, ESCROW_ADDRESS, escrowAbi, STATUS_OPEN } from "@/lib/escrow";
import type { SettlementIntent, SettlementReceipt, StakeBackResult } from "@/lib/types";

export type Payment = { from: Address; to: Address; amount: string; asset: string; resource: string; nonce: string };

function loadAccount() {
  const key = process.env.WALLET_PRIVATE_KEY;
  return key ? privateKeyToAccount(key as Hex) : null;
}

function requireAccount() {
  const account = loadAccount();
  if (!account) throw new Error("The agent has no wallet yet. Set WALLET_PRIVATE_KEY to a test wallet.");
  return account;
}

export async function payAndFetch(url: string) {
  const first = await fetch(url);
  if (first.status !== 402) return { data: await first.json() };

  const account = requireAccount();
  const { price, asset, payTo } = await first.json();
  const payment: Payment = {
    from: account.address,
    to: payTo,
    amount: price,
    asset,
    resource: new URL(url).pathname,
    nonce: crypto.randomUUID(),
  };
  const signature = await account.signMessage({ message: JSON.stringify(payment) });
  const header = Buffer.from(JSON.stringify({ payment, signature })).toString("base64");

  const paid = await fetch(url, { headers: { "X-PAYMENT": header } });
  return {
    data: await paid.json(),
    payment: { status: paid.status, amount: `${price} ${asset}`, to: payTo, signature: `${signature.slice(0, 18)}...` },
  };
}

export async function verifyPayment(header: string | null) {
  if (!header) return null;
  try {
    const { payment, signature } = JSON.parse(Buffer.from(header, "base64").toString()) as {
      payment: Payment;
      signature: Hex;
    };
    const valid = await verifyMessage({ address: payment.from, message: JSON.stringify(payment), signature });
    return valid ? payment : null;
  } catch {
    return null;
  }
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

export interface StakeBacker {
  back(input: { promiseId: string; amountUsdc: string; backerAddress?: string }): Promise<StakeBackResult>;
}

export class X402StakeBacker implements StakeBacker {
  async back(input: { promiseId: string; amountUsdc: string; backerAddress?: string }): Promise<StakeBackResult> {
    return {
      status: "stub",
      week: 3,
      promiseId: input.promiseId,
      amountUsdc: input.amountUsdc,
      asset: "USDC",
      network: "base-sepolia",
      message:
        "Week 3 stub. A friend will back or raise this stake with an x402 micropayment: the endpoint returns 402, payAndFetch signs it, and verifyPayment increases the stake. No payment is accepted yet.",
    };
  }
}

export const stakeBacker: StakeBacker = new X402StakeBacker();

export function backPromiseWithX402(input: {
  promiseId: string;
  amountUsdc: string;
  backerAddress?: string;
}): Promise<StakeBackResult> {
  return stakeBacker.back(input);
}
