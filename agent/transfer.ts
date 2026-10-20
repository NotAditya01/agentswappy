import { GoogleGenAI } from "@google/genai";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chain } from "@/lib/escrow";
import {
  AGENT_CAP,
  erc20TransferAbi,
  overAgentCap,
  promptNamesOtherChain,
  toUnits,
  usdcAddress,
  validateTransfer,
  type Transfer,
} from "@/lib/transfer";
import { callGemini, MODEL, requireGeminiKey } from "./model";

const PARSE_PROMPT = `You read one transfer request and return JSON only:
{"token": "USDC" | "ETH" | other symbol as written, "amount": "decimal string", "to": "0x address exactly as written", "network": "network named in the request, or empty string"}
Copy the address character for character. Do not guess missing fields; use an empty string.
If the text is not a request to send tokens, return {"error": "short reason"}.`;

export type ParseResult = { ok: true; transfer: Transfer } | { ok: false; error: string };

export function readParsed(raw: string): ParseResult {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw.replace(/^```(json)?|```$/g, "").trim());
  } catch {
    return { ok: false, error: "Could not read that as a transfer. Try: send 1 USDC to 0x…" };
  }
  if (typeof data.error === "string" && data.error) return { ok: false, error: data.error };
  return validateTransfer(data);
}

export async function parseTransferPrompt(prompt: string): Promise<ParseResult> {
  const text = prompt.trim().slice(0, 500);
  if (!text) return { ok: false, error: "Type what to send, like: send 1 USDC to 0x…" };
  if (promptNamesOtherChain(text)) {
    return { ok: false, error: "Swappy only sends on Base Sepolia testnet. Mainnet and other chains are not allowed." };
  }

  const ai = new GoogleGenAI({ apiKey: requireGeminiKey() });
  const response = await callGemini((abortSignal) =>
    ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text }] }],
      config: { systemInstruction: PARSE_PROMPT, abortSignal, temperature: 0, responseMimeType: "application/json" },
    }),
    Date.now() + 40_000,
  );
  const parsed = readParsed(response.text ?? "");
  // The model must not invent an address the user never typed.
  if (parsed.ok && !text.toLowerCase().includes(parsed.transfer.to.toLowerCase())) {
    return { ok: false, error: "The recipient address was not in your message. Paste the full 0x address." };
  }
  return parsed;
}

export async function sendFromAgent(transfer: Transfer): Promise<{ hash: Hex; from: string }> {
  const key = process.env.WALLET_PRIVATE_KEY;
  if (!key) throw new Error("The agent wallet is not set up on this server.");
  if (overAgentCap(transfer)) {
    throw new Error(`The agent wallet sends at most ${AGENT_CAP[transfer.token]} ${transfer.token} per transfer.`);
  }

  const account = privateKeyToAccount(key as Hex);
  const reader = createPublicClient({ chain, transport: http() });
  const wallet = createWalletClient({ account, chain, transport: http() });
  const amount = toUnits(transfer.token, transfer.amount);

  let hash: Hex;
  if (transfer.token === "USDC") {
    const balance = await reader.readContract({ address: usdcAddress, abi: erc20TransferAbi, functionName: "balanceOf", args: [account.address] });
    if (balance < amount) throw new Error("The agent wallet does not have enough test USDC.");
    hash = await wallet.writeContract({ address: usdcAddress, abi: erc20TransferAbi, functionName: "transfer", args: [transfer.to, amount] });
  } else {
    const balance = await reader.getBalance({ address: account.address });
    if (balance < amount) throw new Error("The agent wallet does not have enough test ETH.");
    hash = await wallet.sendTransaction({ to: transfer.to, value: amount });
  }

  const receipt = await reader.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`The transfer reverted. Tx ${hash}`);
  return { hash, from: account.address };
}

export function agentAddress(): string | null {
  const key = process.env.WALLET_PRIVATE_KEY;
  return key ? privateKeyToAccount(key as Hex).address : null;
}
