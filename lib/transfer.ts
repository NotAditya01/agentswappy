import { getAddress, isAddress, parseAbi, parseUnits, type Address } from "viem";
import { USDC_ADDRESS } from "./escrow";

export type Token = "USDC" | "ETH";
export type Sender = "agent" | "wallet";

export type Transfer = {
  token: Token;
  amount: string;
  to: Address;
  network: "base-sepolia";
};

export const TOKEN_DECIMALS: Record<Token, number> = { USDC: 6, ETH: 18 };

// The agent wallet only ever sends this much in one transfer.
export const AGENT_CAP: Record<Token, string> = { USDC: "2", ETH: "0.001" };

export const erc20TransferAbi = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);

export const usdcAddress = USDC_ADDRESS;

const OTHER_CHAINS =
  /\b(mainnet|ethereum|eth mainnet|base mainnet|polygon|matic|arbitrum|optimism|bsc|bnb|binance|avalanche|avax|solana|holesky|goerli|zksync|linea|scroll|blast)\b/i;

const BASE_SEPOLIA = /\b(base[\s-]?sepolia|base testnet|testnet)\b/i;

export function wrongNetwork(network: string | null | undefined): boolean {
  const value = (network ?? "").trim();
  if (!value) return false;
  if (BASE_SEPOLIA.test(value)) return false;
  return true;
}

// Catches prompts that name another chain even if the model drops it.
export function promptNamesOtherChain(prompt: string): boolean {
  const cleaned = prompt.replace(/base[\s-]?sepolia/gi, "");
  return OTHER_CHAINS.test(cleaned) && !/^\s*$/.test(cleaned);
}

export function toUnits(token: Token, amount: string): bigint {
  return parseUnits(amount, TOKEN_DECIMALS[token]);
}

export function validateTransfer(input: {
  token?: unknown;
  amount?: unknown;
  to?: unknown;
  network?: unknown;
}): { ok: true; transfer: Transfer } | { ok: false; error: string } {
  const token = String(input.token ?? "").trim().toUpperCase();
  if (token !== "USDC" && token !== "ETH") {
    return { ok: false, error: "Only USDC and ETH on Base Sepolia are supported." };
  }

  if (typeof input.network === "string" && wrongNetwork(input.network)) {
    return { ok: false, error: `Swappy only sends on Base Sepolia testnet, not ${input.network}.` };
  }

  const amount = String(input.amount ?? "").trim();
  const decimals = TOKEN_DECIMALS[token];
  if (!/^\d+(\.\d+)?$/.test(amount)) return { ok: false, error: "The amount must be a plain positive number." };
  const fraction = amount.split(".")[1] ?? "";
  if (fraction.length > decimals) return { ok: false, error: `${token} has at most ${decimals} decimals.` };
  if (parseUnits(amount, decimals) <= 0n) return { ok: false, error: "The amount must be more than zero." };

  const to = String(input.to ?? "").trim();
  if (!isAddress(to, { strict: false })) return { ok: false, error: "The recipient is not a valid 0x address." };
  if (/^0x0{40}$/i.test(to)) return { ok: false, error: "Sending to the zero address would burn the tokens." };

  return { ok: true, transfer: { token, amount, to: getAddress(to), network: "base-sepolia" } };
}

export function overAgentCap(transfer: Transfer): boolean {
  return toUnits(transfer.token, transfer.amount) > toUnits(transfer.token, AGENT_CAP[transfer.token]);
}
