import { GoogleGenAI, type Content, type Part } from "@google/genai";
import { callGemini, GEMINI_BUSY, geminiFailure, MODEL, requireGeminiKey } from "./model";
import { tools, type Tool, type ToolContext } from "./tools";
import { clampVerdict } from "@/lib/verdict";
import type { PromiseRecord, ProofCheckResult, TraceStep, Verdict } from "@/lib/types";

export { MODEL };

const CHECK_BUDGET_MS = 240_000;

const MAX_STEPS = 6;

export type ChatMessage = { role: "user" | "agent"; text: string };

function isProofResult(value: unknown): value is ProofCheckResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<ProofCheckResult>;
  return typeof result.summary === "string" && typeof result.verified === "boolean" && typeof result.suggestedVerdict === "string";
}

function isGeminiToolFailure(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.startsWith("Gemini") || message.includes("GEMINI_API_KEY");
}

function systemPrompt(promise: PromiseRecord): string {
  return [
    "You are Swappy, the agent inside Proof of Promise. You check a personal promise. Someone named a stake. You only decide the verdict; the app settles the stake afterwards.",
    `This promise uses proof type ${promise.proofType}. Call that tool before you decide:`,
    "github_commits calls check_github_commits, image calls check_image_proof, strava calls check_strava_activity.",
    "The tool returns evidence from GitHub, from Gemini vision, or from the Strava stub. Do not invent commits, photo details, or activities.",
    "Read the evidence, then call record_verdict once.",
    "kept means the evidence shows the goal was met.",
    "broken means the deadline has passed and the evidence shows the goal was missed, including no photo after the deadline.",
    "pending means the deadline is still ahead and the goal is not met yet, or the tool could not verify the proof.",
    "If verified is false, record pending. Never treat a failed check as a broken promise.",
    "suggestedVerdict is only a hint. Decide from the evidence itself.",
    "The explanation is two to four sentences and cites the evidence.",
  ].join(" ");
}

function userPrompt(promise: PromiseRecord): string {
  const deadline = new Date(promise.deadline);
  const open = deadline.getTime() > Date.now();
  return [
    "Check this promise and record a verdict.",
    `What they promised: ${promise.description}`,
    `Target: ${promise.target}`,
    `Deadline: ${promise.deadline} (${open ? "still in the future" : "already passed"})`,
    `Stake: ${promise.stakeUsdc} USDC${promise.onchain ? " in escrow" : ", simulated"}`,
    `If they break it, it would go to: ${promise.beneficiaryName}`,
    `Proof type: ${promise.proofType}`,
    `Details: ${JSON.stringify(promise.criteria)}`,
    promise.imageProof
      ? `Photo attached: ${promise.imageProof.fileName} (${promise.imageProof.bytes} bytes)`
      : "No photo is attached.",
  ].join("\n");
}

export async function runAgent(
  history: ChatMessage[],
  ctx: ToolContext,
  options?: { systemPrompt?: string; toolList?: Tool[]; maxSteps?: number },
) {
  const ai = new GoogleGenAI({ apiKey: requireGeminiKey() });
  const toolList = options?.toolList ?? tools;
  const contents: Content[] = history.map((message) => ({
    role: message.role === "user" ? "user" : "model",
    parts: [{ text: message.text }],
  }));
  const steps: TraceStep[] = [];
  const maxSteps = options?.maxSteps ?? MAX_STEPS;
  const deadline = Date.now() + CHECK_BUDGET_MS;

  for (let i = 0; i < maxSteps; i++) {
    if (Date.now() >= deadline) throw new Error(GEMINI_BUSY);
    const response = await callGemini((abortSignal) => ai.models.generateContent({
      model: MODEL,
      contents,
      config: {
        systemInstruction: options?.systemPrompt,
        abortSignal,
        temperature: 0.2,
        tools: [
          {
            functionDeclarations: toolList.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parametersJsonSchema: tool.parameters,
            })),
          },
        ],
      },
    }), deadline);

    const calls = response.functionCalls ?? [];
    if (calls.length === 0) return { answer: response.text ?? "", steps };

    const content = response.candidates?.[0]?.content;
    if (!content) {
      throw new Error("Gemini returned a tool call without a message we can continue. Nothing was settled.");
    }
    contents.push(content);

    const ordered = [...calls].sort((a, b) => {
      if (a.name === "record_verdict") return 1;
      if (b.name === "record_verdict") return -1;
      return 0;
    });
    const results: Part[] = [];

    for (const call of ordered) {
      const tool = toolList.find((item) => item.name === call.name);
      let result: unknown;
      let error = false;
      try {
        if (!tool) throw new Error(`No tool named ${call.name}`);
        result = await tool.run((call.args ?? {}) as Record<string, unknown>, ctx);
      } catch (err) {
        if (isGeminiToolFailure(err)) throw err;
        result = { error: err instanceof Error ? err.message : String(err) };
        error = true;
      }
      steps.push({ tool: call.name ?? "unknown", args: call.args ?? {}, result, error });
      results.push({ functionResponse: { id: call.id, name: call.name, response: { result } } });
    }

    contents.push({ role: "user", parts: results });
    if (ctx.recorded) return { answer: ctx.recorded.explanation, steps };
  }

  return { answer: "The agent stopped before it recorded a verdict.", steps };
}

export type Judgment = {
  verdict: Verdict;
  explanation: string;
  steps: TraceStep[];
  decidedBy: "agent";
};

function latestEvidence(steps: TraceStep[]): ProofCheckResult | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (!step.error && isProofResult(step.result)) return step.result;
  }
  return null;
}

export async function judgePromise(promise: PromiseRecord): Promise<Judgment> {
  const ctx: ToolContext = { baseUrl: "", promise, evidenceSeen: false, recorded: null };
  let steps: TraceStep[] = [];
  let answer = "";

  try {
    const result = await runAgent([{ role: "user", text: userPrompt(promise) }], ctx, {
      systemPrompt: systemPrompt(promise),
      maxSteps: MAX_STEPS,
    });
    steps = result.steps;
    answer = result.answer;
  } catch (err) {
    if (err instanceof Error && err.message.includes("Nothing was settled")) throw err;
    throw geminiFailure("Gemini could not check this promise.", err);
  }

  if (!ctx.recorded) {
    const extra = answer ? ` ${answer.slice(0, 280)}` : "";
    throw new Error(`Gemini did not record a verdict.${extra} Nothing was settled.`);
  }

  const evidence = latestEvidence(steps);
  const clamped = clampVerdict(ctx.recorded.verdict, evidence);
  if (clamped.clamped) {
    return {
      verdict: clamped.verdict,
      explanation: `${ctx.recorded.explanation} The check did not finish, so this stays unsettled.`,
      steps,
      decidedBy: "agent",
    };
  }

  return {
    verdict: ctx.recorded.verdict,
    explanation: ctx.recorded.explanation,
    steps,
    decidedBy: "agent",
  };
}
