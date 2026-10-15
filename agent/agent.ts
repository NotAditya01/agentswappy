/**
 * THE AGENT
 *
 * judgePromise runs one accountability decision:
 *   1. Ask Gemini to call the proof tool for this promise.
 *   2. Gemini records kept, broken, or pending, with an explanation.
 *   3. If that verdict matches the proof tool, it stands.
 *      If it does not, settlement follows the proof tool and the explanation says so.
 *   4. With no API key, the same proof tool decides and the explanation says the model did not run.
 */
import { GoogleGenAI, type Content, type Part } from "@google/genai";
import { checkProof, proofToolName } from "./proofs/check";
import { MODEL } from "./model";
import { tools, type Tool, type ToolContext } from "./tools";
import { clampVerdict } from "@/lib/verdict";
import type { DecidedBy, PromiseRecord, ProofCheckResult, TraceStep, Verdict } from "@/lib/types";

export { MODEL };

const MAX_STEPS = 6;

export type ChatMessage = { role: "user" | "agent"; text: string };

function isProofResult(value: unknown): value is ProofCheckResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<ProofCheckResult>;
  return typeof result.summary === "string" && typeof result.verified === "boolean" && typeof result.suggestedVerdict === "string";
}

function systemPrompt(promise: PromiseRecord): string {
  return [
    "You are Proof-of-Promise, an accountability agent.",
    "A person staked USDC on a promise. You verify it with tools and decide whether it was kept.",
    `This promise uses proof type ${promise.proofType}. Call only that checker:`,
    "- github_commits -> check_github_commits",
    "- image -> check_image_proof",
    "- strava -> check_strava_activity",
    "The checker returns evidence and suggestedVerdict (kept, broken, or pending).",
    "Do not invent commits, pixels, or activities.",
    "Agree with suggestedVerdict unless the evidence block contradicts it. If you disagree, say why.",
    "If the checker could not verify the proof, the verdict is pending. Never slash an unverified stake.",
    "After the checker returns, call record_verdict exactly once.",
    "The explanation is two to four sentences a person can read, and it must cite the evidence.",
    "Do not claim that funds moved. Settlement is mocked and happens after your verdict.",
  ].join(" ");
}

function userPrompt(promise: PromiseRecord): string {
  const deadline = new Date(promise.deadline);
  const open = deadline.getTime() > Date.now();
  return [
    "Decide this promise.",
    `Description: ${promise.description}`,
    `Target: ${promise.target}`,
    `Deadline: ${promise.deadline} (${open ? "still in the future" : "already passed"})`,
    `Stake: ${promise.stakeUsdc} USDC`,
    `Refund address: ${promise.makerAddress}`,
    `Beneficiary: ${promise.beneficiaryName} (${promise.beneficiaryAddress})`,
    `Proof type: ${promise.proofType}`,
    `Criteria: ${JSON.stringify(promise.criteria)}`,
    promise.imageProof ? `Photo attached: ${promise.imageProof.fileName}` : "No photo is attached.",
    "Check the proof, then record the verdict.",
  ].join("\n");
}

export async function runAgent(
  history: ChatMessage[],
  ctx: ToolContext,
  options?: { systemPrompt?: string; toolList?: Tool[]; maxSteps?: number },
) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const toolList = options?.toolList ?? tools;
  const contents: Content[] = history.map((message) => ({
    role: message.role === "user" ? "user" : "model",
    parts: [{ text: message.text }],
  }));
  const steps: TraceStep[] = [];
  const maxSteps = options?.maxSteps ?? MAX_STEPS;

  for (let i = 0; i < maxSteps; i++) {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: {
        systemInstruction: options?.systemPrompt,
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
    });

    const calls = response.functionCalls ?? [];
    if (calls.length === 0) return { answer: response.text ?? "", steps };

    const content = response.candidates?.[0]?.content;
    if (!content) return { answer: response.text || "The model returned no content.", steps };
    contents.push(content);
    const results: Part[] = [];

    for (const call of calls) {
      const tool = toolList.find((item) => item.name === call.name);
      let result: unknown;
      let error = false;
      try {
        if (!tool) throw new Error(`No tool named ${call.name}`);
        result = await tool.run((call.args ?? {}) as Record<string, unknown>, ctx);
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
        error = true;
      }
      steps.push({ tool: call.name ?? "unknown", args: call.args ?? {}, result, error });
      results.push({ functionResponse: { id: call.id, name: call.name, response: { result } } });
    }

    contents.push({ role: "user", parts: results });
  }

  return { answer: "I hit my step limit before recording a verdict.", steps };
}

export type Judgment = {
  verdict: Verdict;
  explanation: string;
  steps: TraceStep[];
  decidedBy: DecidedBy;
};

function latestEvidence(steps: TraceStep[]): ProofCheckResult | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (!step.error && isProofResult(step.result)) return step.result;
  }
  return null;
}

function applyEvidence(evidence: ProofCheckResult, steps: TraceStep[], prefix: string): Judgment {
  return {
    verdict: evidence.suggestedVerdict,
    explanation: `${prefix} ${evidence.summary}`.trim(),
    steps,
    decidedBy: "evidence-rules",
  };
}

export async function judgePromise(promise: PromiseRecord): Promise<Judgment> {
  if (!process.env.GEMINI_API_KEY) {
    const evidence = await checkProof(promise);
    return applyEvidence(
      evidence,
      [{ tool: proofToolName(promise), args: { promiseId: promise.id }, result: evidence }],
      "GEMINI_API_KEY is not set, so the proof checker rules decided.",
    );
  }

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
    const evidence = await checkProof(promise);
    return applyEvidence(
      evidence,
      [
        { tool: "agent", args: {}, result: { error: err instanceof Error ? err.message : String(err) }, error: true },
        { tool: proofToolName(promise), args: { promiseId: promise.id }, result: evidence },
      ],
      "The model call failed, so the proof checker rules decided.",
    );
  }

  const evidence = latestEvidence(steps);
  if (!ctx.recorded) {
    if (evidence) {
      return applyEvidence(evidence, steps, "The model did not record a verdict, so the proof checker rules decided.");
    }
    return {
      verdict: "pending",
      explanation: answer || "The agent could not verify this promise. Nothing was settled.",
      steps,
      decidedBy: "evidence-rules",
    };
  }

  const clamped = clampVerdict(ctx.recorded.verdict, evidence);
  const explanation = clamped.clamped
    ? `${ctx.recorded.explanation} Settlement uses ${clamped.verdict} because ${clamped.reason}.`
    : ctx.recorded.explanation;

  return {
    verdict: clamped.verdict,
    explanation,
    steps,
    decidedBy: clamped.clamped ? "evidence-rules" : "agent",
  };
}
