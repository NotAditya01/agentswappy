import fs from "fs/promises";
import { GoogleGenAI } from "@google/genai";
import { MODEL } from "../model";
import { proofFilePath } from "../../lib/store";
import { verdictFromCheck } from "../../lib/verdict";
import type { ImageCriteria, PromiseRecord, ProofCheckResult } from "../../lib/types";

const CONFIDENT = 0.55;

function parseVision(text: string): { matches: boolean; confidence: number; observation: string } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      matches?: unknown;
      confidence?: unknown;
      observation?: unknown;
    };
    const confidence = Number(parsed.confidence);
    if (typeof parsed.matches !== "boolean" || !Number.isFinite(confidence)) return null;
    return {
      matches: parsed.matches,
      confidence: Math.min(1, Math.max(0, confidence)),
      observation: String(parsed.observation ?? "").slice(0, 400),
    };
  } catch {
    return null;
  }
}

export async function checkImageProof(promise: PromiseRecord, now = new Date()): Promise<ProofCheckResult> {
  const claim = (promise.criteria as ImageCriteria).claim;
  const base = { provider: "image" as const, goalMet: false, missingUserProof: false };

  if (!promise.imageProof) {
    const suggestedVerdict = verdictFromCheck({
      deadline: promise.deadline,
      verified: true,
      goalMet: false,
      missingUserProof: true,
      now,
    });
    return {
      ...base,
      verified: true,
      missingUserProof: true,
      suggestedVerdict,
      summary:
        suggestedVerdict === "broken"
          ? "The deadline passed and no photo was uploaded."
          : "No photo has been uploaded yet. The stake stays unsettled until one is.",
      evidence: { claim, uploaded: false },
    };
  }

  if (!process.env.GEMINI_API_KEY) {
    return {
      ...base,
      verified: false,
      suggestedVerdict: "pending",
      summary: "A photo is attached, but GEMINI_API_KEY is missing, so vision did not run. Nothing is settled.",
      evidence: { claim, uploaded: true, fileName: promise.imageProof.fileName },
    };
  }

  try {
    const bytes = await fs.readFile(proofFilePath(promise.imageProof.storedName));
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: [
                "You check photo proof for an accountability promise.",
                `Promise: ${promise.description}`,
                `The photo must show: ${claim}`,
                "Look only at the image. Do not assume facts that are not visible.",
                'Reply with JSON only: {"matches": boolean, "confidence": number between 0 and 1, "observation": "one sentence"}',
                "matches is true only when the image clearly shows the claim.",
              ].join("\n"),
            },
            { inlineData: { mimeType: promise.imageProof.mimeType, data: bytes.toString("base64") } },
          ],
        },
      ],
      config: { temperature: 0, responseMimeType: "application/json" },
    });

    const parsed = parseVision(response.text ?? "");
    if (!parsed || parsed.confidence < CONFIDENT) {
      return {
        ...base,
        verified: false,
        suggestedVerdict: "pending",
        summary: parsed
          ? `The photo check is unsure (${parsed.observation || "low confidence"}). Nothing is settled.`
          : "Vision did not return a readable judgment. Nothing is settled.",
        evidence: {
          claim,
          uploaded: true,
          fileName: promise.imageProof.fileName,
          observation: parsed?.observation ?? null,
          confidence: parsed?.confidence ?? null,
        },
      };
    }

    const suggestedVerdict = verdictFromCheck({
      deadline: promise.deadline,
      verified: true,
      goalMet: parsed.matches,
      missingUserProof: false,
      now,
    });
    return {
      provider: "image",
      verified: true,
      goalMet: parsed.matches,
      missingUserProof: false,
      suggestedVerdict,
      summary: parsed.matches
        ? `The photo matches the claim. ${parsed.observation}`
        : `The photo does not match the claim. ${parsed.observation}`,
      evidence: {
        claim,
        uploaded: true,
        fileName: promise.imageProof.fileName,
        matches: parsed.matches,
        confidence: parsed.confidence,
        observation: parsed.observation,
      },
    };
  } catch (err) {
    return {
      ...base,
      verified: false,
      suggestedVerdict: "pending",
      summary: `Vision failed (${err instanceof Error ? err.message : String(err)}). Nothing is settled.`,
      evidence: { claim, uploaded: true, fileName: promise.imageProof.fileName },
    };
  }
}
