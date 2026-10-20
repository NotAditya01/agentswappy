import { GoogleGenAI } from "@google/genai";
import { toIntent, type Intent } from "@/lib/intent";
import { promptNamesOtherChain } from "@/lib/transfer";
import type { PromiseRecord } from "@/lib/types";
import { callGemini, MODEL, requireGeminiKey } from "./model";

function systemPrompt(now: Date) {
  return `You read one request to Swappy, a promise-keeping agent on Base Sepolia testnet. Return JSON only.
Now is ${now.toISOString()} (the user is in India, UTC+5:30). Turn relative dates like "Friday" into a full ISO time; use 23:59 IST if no time is given.

Pick one intent:
- "create_promise": the user promises to do something. Fields: description (short, first person dropped, e.g. "Push 3 commits to owner/repo"), deadline (ISO), repo ("owner/repo" if it is about GitHub commits, else ""), minCommits (number), claim (what a photo should show, if not GitHub), stake (USDC number as string, "" if not given), beneficiaryAddress (0x address to pay if broken, as written, or ""), beneficiaryName ("" if not given).
- "back_promise": the user wants to put USDC behind an existing promise. Fields: target (the promise title words or id as written), amount (USDC as string).
- "send": a plain token transfer. Fields: token ("USDC", "ETH" or as written), amount (string), to (0x address exactly as written), network (named network or "").
- "unclear": anything else. Field: question (one short question to ask back).
Copy addresses character for character. Never invent values; use "" when missing.`;
}

export async function parseAsk(prompt: string, promises: PromiseRecord[]): Promise<Intent> {
  const text = prompt.trim().slice(0, 600);
  if (!text) return { kind: "clarify", question: "What do you want to do? Make a promise, back one, or send tokens." };
  if (promptNamesOtherChain(text)) {
    return { kind: "clarify", question: "Swappy only works on Base Sepolia testnet. Mainnet and other chains are not allowed." };
  }

  const ai = new GoogleGenAI({ apiKey: requireGeminiKey() });
  const response = await callGemini((abortSignal) =>
    ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text }] }],
      config: { systemInstruction: systemPrompt(new Date()), abortSignal, temperature: 0, responseMimeType: "application/json" },
    }),
    Date.now() + 40_000,
  );

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse((response.text ?? "").replace(/^```(json)?|```$/g, "").trim());
  } catch {
    return { kind: "clarify", question: "I could not read that. Try one of the examples." };
  }

  const intent = toIntent(raw, promises);
  // The model must not invent an address the user never typed.
  const typed = text.toLowerCase();
  if (intent.kind === "send" && !typed.includes(intent.transfer.to.toLowerCase())) {
    return { kind: "clarify", question: "Paste the full 0x address you want to send to." };
  }
  if (intent.kind === "create_promise" && intent.prefill.beneficiaryAddress && !typed.includes(intent.prefill.beneficiaryAddress.toLowerCase())) {
    intent.prefill.beneficiaryAddress = "";
  }
  return intent;
}
