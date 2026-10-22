import { getAddress, isAddress, toHex, type Address, type Hex } from "viem";
import { chain, USDC_ADDRESS, usdcUnits } from "./escrow";

// x402 v1, "exact" scheme on Base Sepolia. The friend signs a USDC
// transferWithAuthorization (EIP-3009) to the escrow, and a facilitator
// submits it. No gas for the friend, no approve step.

export const X402_NETWORK = "base-sepolia";
export const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || "https://x402.org/facilitator";
export const MIN_BACKING = "0.01";
export const MAX_BACKING = "5";

export type PaymentRequirements = {
  scheme: "exact";
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: Address;
  maxTimeoutSeconds: number;
  asset: Address;
  extra: { name: string; version: string };
};

export type Authorization = {
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
};

export type PaymentPayload = {
  x402Version: 1;
  scheme: "exact";
  network: string;
  payload: { signature: Hex; authorization: Authorization };
};

// Friend picks the amount; keep it to small test-USDC micro-payments.
export function parseBackingAmount(value: unknown): string | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d+(\.\d{1,6})?$/.test(text)) return null;
  const units = usdcUnits(text);
  if (units < usdcUnits(MIN_BACKING) || units > usdcUnits(MAX_BACKING)) return null;
  return text;
}

export function backingRequirements(input: { amountUsdc: string; resource: string; payTo: Address }): PaymentRequirements {
  return {
    scheme: "exact",
    network: X402_NETWORK,
    maxAmountRequired: usdcUnits(input.amountUsdc).toString(),
    resource: input.resource,
    description: `Back a promise with ${input.amountUsdc} USDC`,
    mimeType: "application/json",
    payTo: input.payTo,
    maxTimeoutSeconds: 300,
    asset: USDC_ADDRESS,
    extra: { name: "USDC", version: "2" },
  };
}

export function encodePayment(payment: PaymentPayload): string {
  return btoa(JSON.stringify(payment));
}

export function decodePayment(header: string | null): PaymentPayload | null {
  if (!header) return null;
  try {
    const parsed = JSON.parse(atob(header)) as PaymentPayload;
    const auth = parsed?.payload?.authorization;
    if (parsed.x402Version !== 1 || parsed.scheme !== "exact" || parsed.network !== X402_NETWORK) return null;
    if (!auth || !isAddress(auth.from) || !isAddress(auth.to) || !/^\d+$/.test(auth.value)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Checks the parts we care about before asking the facilitator.
export function matchesRequirements(payment: PaymentPayload, req: PaymentRequirements): boolean {
  const auth = payment.payload.authorization;
  return getAddress(auth.to) === getAddress(req.payTo) && auth.value === req.maxAmountRequired;
}

type Signer = {
  signTypedData: (args: {
    account?: Address | { address: Address };
    domain: Record<string, unknown>;
    types: Record<string, { name: string; type: string }[]>;
    primaryType: string;
    message: Record<string, unknown>;
  }) => Promise<Hex>;
};

// Builds and signs the X-PAYMENT header. Works with a viem local account or a browser wallet client.
export async function signPayment(signer: Signer, from: Address, req: PaymentRequirements): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const authorization: Authorization = {
    from,
    to: req.payTo,
    value: req.maxAmountRequired,
    validAfter: String(now - 600),
    validBefore: String(now + req.maxTimeoutSeconds),
    nonce,
  };
  const signature = await signer.signTypedData({
    account: from,
    domain: { name: req.extra.name, version: req.extra.version, chainId: chain.id, verifyingContract: req.asset },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: {
      ...authorization,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
    },
  });
  return encodePayment({ x402Version: 1, scheme: "exact", network: X402_NETWORK, payload: { signature, authorization } });
}

async function facilitator<T>(path: "verify" | "settle", payment: PaymentPayload, req: PaymentRequirements): Promise<T> {
  const res = await fetch(`${FACILITATOR_URL}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ x402Version: 1, paymentPayload: payment, paymentRequirements: req }),
  });
  const data = (await res.json().catch(() => null)) as T | null;
  if (!data) throw new Error(`The x402 facilitator returned ${res.status}.`);
  return data;
}

export function verifyWithFacilitator(payment: PaymentPayload, req: PaymentRequirements) {
  return facilitator<{ isValid: boolean; invalidReason?: string; payer?: string }>("verify", payment, req);
}

export function settleWithFacilitator(payment: PaymentPayload, req: PaymentRequirements) {
  return facilitator<{ success: boolean; errorReason?: string; transaction?: Hex; network?: string; payer?: string }>(
    "settle",
    payment,
    req,
  );
}
