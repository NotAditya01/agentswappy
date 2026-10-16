import fs from "fs";
import os from "os";
import path from "path";
import { verifyMessage, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { SettlementIntent, SettlementReceipt, StakeBackResult } from "@/lib/types";

const WALLET_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), "proof-of-promise")
  : process.cwd();
const WALLET_FILE = path.join(WALLET_DIR, ".agent-wallet.json");

export type Payment = { from: Address; to: Address; amount: string; asset: string; resource: string; nonce: string };

function loadAccount() {
  const key = process.env.WALLET_PRIVATE_KEY || (fs.existsSync(WALLET_FILE) && JSON.parse(fs.readFileSync(WALLET_FILE, "utf8")).privateKey);
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

export const stakeSettler: StakeSettler = new MockStakeSettler();

export function settleStake(intent: SettlementIntent): Promise<SettlementReceipt> {
  return stakeSettler.settle(intent);
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
