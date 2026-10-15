/**
 * THE AGENT'S WALLET
 *
 * The agent owns a wallet (a private key). Week 3 friends use it to sign x402
 * micropayments. Settlement of a promise stake goes through StakeSettler.
 *
 * Week 2 settlement is mocked: MockStakeSettler records who would be paid and
 * stops. It never signs or broadcasts a transaction. Replace that class with a
 * Base Sepolia USDC transfer when escrow exists.
 *
 * You create the wallet with the "Create wallet" button on the page.
 * It is saved in `.agent-wallet.json` so it survives restarts.
 */
import fs from "fs";
import path from "path";
import { createPublicClient, formatEther, http, verifyMessage, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import type { SettlementIntent, SettlementReceipt, StakeBackResult } from "@/lib/types";

const WALLET_FILE = path.join(process.cwd(), ".agent-wallet.json");
const chain = createPublicClient({ chain: baseSepolia, transport: http() });

export type Payment = { from: Address; to: Address; amount: string; asset: string; resource: string; nonce: string };

/** The wallet from .env or .agent-wallet.json, or null if none was created yet. */
function loadAccount() {
  const key = process.env.WALLET_PRIVATE_KEY || (fs.existsSync(WALLET_FILE) && JSON.parse(fs.readFileSync(WALLET_FILE, "utf8")).privateKey);
  return key ? privateKeyToAccount(key as Hex) : null;
}

function requireAccount() {
  const account = loadAccount();
  if (!account) throw new Error("The agent has no wallet yet. Ask the user to click 'Create wallet' first.");
  return account;
}

/** Make a brand new wallet and save it. */
export function createWallet() {
  if (loadAccount()) return getWalletAddress();
  const privateKey = generatePrivateKey();
  fs.writeFileSync(WALLET_FILE, JSON.stringify({ privateKey }, null, 2));
  return privateKeyToAccount(privateKey).address;
}

export function getWalletAddress() {
  return loadAccount()?.address ?? null;
}

export async function getWalletBalance() {
  const wei = await chain.getBalance({ address: requireAccount().address });
  return `${formatEther(wei)} ETH`;
}

/**
 * Fetch a URL. If it asks for payment (402), sign one with the wallet and try again.
 * Week 3 stake backing should call this against POST /api/promises/:id/back.
 * Payments are signed but not submitted on-chain.
 */
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

/** Used by a paid API: is this X-PAYMENT header a real, signed payment? */
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

/** What a Base Sepolia settlement implementation must satisfy. */
export interface StakeSettler {
  settle(intent: SettlementIntent): Promise<SettlementReceipt>;
}

/**
 * Records the refund or forfeit and does not move funds.
 *
 * A Base Sepolia replacement should:
 *   1. Hold the stake in escrow when the promise is created.
 *   2. On kept, transfer USDC to makerAddress.
 *   3. On broken, transfer USDC to beneficiaryAddress.
 *   4. Return the transaction hash instead of null.
 */
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
        ? "Mock settlement. The stake would return to the maker on Base Sepolia. No transaction was broadcast."
        : `Mock settlement. The stake would go to ${intent.beneficiaryName} on Base Sepolia. No transaction was broadcast.`,
    };
  }
}

/** Active settler. Swap this for an on-chain implementation later. */
export const stakeSettler: StakeSettler = new MockStakeSettler();

export function settleStake(intent: SettlementIntent): Promise<SettlementReceipt> {
  return stakeSettler.settle(intent);
}

export interface StakeBacker {
  /** Week 3: accept an x402 micropayment that increases a promise stake. */
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
