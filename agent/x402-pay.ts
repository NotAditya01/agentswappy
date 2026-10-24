import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount, type LocalAccount } from "viem/accounts";
import { USDC_ADDRESS, usdcUnits } from "@/lib/escrow";
import { AGENT_CAP } from "@/lib/transfer";
import type { PromiseRecord } from "@/lib/types";
import { signPayment, X402_NETWORK, type PaymentRequirements } from "@/lib/x402";

// Swappy as an x402 client: it pays its own /back endpoint from the agent wallet.
// Same flow a browser wallet goes through, just signed on the server.

export type PayStep =
  | { step: "quote"; amountUsdc: string; payTo: Address; network: string }
  | { step: "signed"; from: Address }
  | { step: "paying" }
  | { step: "settled"; paymentTx: Hex; creditTx: Hex; payer: Address };

export type AgentBacking = { paymentTx: Hex; creditTx: Hex; payer: Address; amountUsdc: string; promise: PromiseRecord };

export class AgentPayError extends Error {
  constructor(message: string, readonly status = 400, readonly paymentTx?: string) {
    super(message);
  }
}

export function overAgentBackingCap(amountUsdc: string): boolean {
  return usdcUnits(amountUsdc) > usdcUnits(AGENT_CAP.USDC);
}

export function agentAccount(): LocalAccount {
  const key = process.env.WALLET_PRIVATE_KEY;
  if (!key) throw new AgentPayError("The agent wallet is not set up on this server.", 503);
  return privateKeyToAccount(key as Hex);
}

// Never sign something other than what was asked: exact amount, USDC, base-sepolia, to the escrow.
export function checkQuote(req: PaymentRequirements | undefined, amountUsdc: string, escrow: Address): PaymentRequirements {
  if (!req) throw new AgentPayError("The back endpoint sent no payment details.", 502);
  if (req.scheme !== "exact" || req.network !== X402_NETWORK) throw new AgentPayError("The endpoint asked for a payment on another network.", 502);
  if (getAddress(req.asset) !== getAddress(USDC_ADDRESS)) throw new AgentPayError("The endpoint asked for a token other than USDC.", 502);
  if (getAddress(req.payTo) !== getAddress(escrow)) throw new AgentPayError("The endpoint asked to pay someone other than the escrow.", 502);
  if (req.maxAmountRequired !== usdcUnits(amountUsdc).toString()) throw new AgentPayError("The endpoint asked for a different amount.", 502);
  return req;
}

function readPaymentResponse(header: string | null): { transaction?: Hex; payer?: Address } {
  if (!header) return {};
  try {
    return JSON.parse(atob(header));
  } catch {
    return {};
  }
}

export async function agentBack(input: {
  promiseId: string;
  amountUsdc: string;
  origin: string;
  escrow: Address;
  account?: LocalAccount;
  fetchImpl?: typeof fetch;
  onStep?: (step: PayStep) => void;
}): Promise<AgentBacking> {
  const { promiseId, amountUsdc, origin, escrow } = input;
  if (overAgentBackingCap(amountUsdc)) throw new AgentPayError(`Swappy pays at most ${AGENT_CAP.USDC} USDC per backing.`);
  const account = input.account ?? agentAccount();
  const fetcher = input.fetchImpl ?? fetch;
  const url = `${origin}/api/promises/${encodeURIComponent(promiseId)}/back?amount=${encodeURIComponent(amountUsdc)}`;

  // 1. Ask for the resource without paying. Expect 402 with the price.
  const first = await fetcher(url, { method: "POST" });
  const quote = (await first.json().catch(() => ({}))) as { error?: string; accepts?: PaymentRequirements[] };
  if (first.status !== 402) throw new AgentPayError(quote.error || "The back endpoint did not ask for a payment.", first.status >= 400 ? first.status : 502);
  const req = checkQuote(quote.accepts?.[0], amountUsdc, escrow);
  input.onStep?.({ step: "quote", amountUsdc, payTo: getAddress(req.payTo), network: req.network });

  // 2. Sign an EIP-3009 transferWithAuthorization with the agent key. No gas from us.
  const header = await signPayment(account, account.address, req);
  input.onStep?.({ step: "signed", from: account.address });

  // 3. Retry with X-PAYMENT. The endpoint verifies, the facilitator settles on chain, then Swappy credits it.
  input.onStep?.({ step: "paying" });
  const paid = await fetcher(url, { method: "POST", headers: { "X-PAYMENT": header } });
  const data = (await paid.json().catch(() => ({}))) as PromiseRecord & { error?: string; paymentTx?: string };
  const receipt = readPaymentResponse(paid.headers.get("x-payment-response"));
  if (!paid.ok) throw new AgentPayError(data.error || "The payment failed.", paid.status, data.paymentTx ?? receipt.transaction);

  const paymentTx = receipt.transaction;
  const backing = data.backings?.find((b) => paymentTx && b.txHash.toLowerCase() === paymentTx.toLowerCase());
  if (!paymentTx || !backing) throw new AgentPayError("Paid, but the endpoint did not return the settlement.", 502, paymentTx);
  const result = { paymentTx, creditTx: backing.creditTx as Hex, payer: getAddress(backing.backer), amountUsdc: backing.amountUsdc, promise: data };
  input.onStep?.({ step: "settled", paymentTx, creditTx: result.creditTx, payer: result.payer });
  return result;
}
