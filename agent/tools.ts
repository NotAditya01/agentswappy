import type { GithubCriteria, PromiseRecord, StravaCriteria, Verdict } from "@/lib/types";
import { checkGithubCommits } from "./proofs/github";
import { checkImageProof } from "./proofs/image";
import { checkStravaActivity } from "./proofs/strava";

export type ToolContext = {
  baseUrl: string;
  promise?: PromiseRecord;
  evidenceSeen: boolean;
  recorded: { verdict: Verdict; explanation: string } | null;
};

export type Tool = {
  name: string;
  description: string;
  parameters: object;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
};

const VERDICTS: Verdict[] = ["kept", "broken", "pending"];

function requirePromise(ctx: ToolContext): PromiseRecord {
  if (!ctx.promise) throw new Error("No promise is attached to this check.");
  return ctx.promise;
}

export const tools: Tool[] = [
  {
    name: "check_github_commits",
    description:
      "Count public GitHub commits for the current promise. Use this only when the proof type is github_commits. Returns evidence and a suggestedVerdict of kept, broken, or pending.",
    parameters: { type: "object", properties: {} },
    run: async (_args, ctx) => {
      const promise = requirePromise(ctx);
      if (promise.proofType !== "github_commits") {
        throw new Error("This promise is not checked with GitHub commits.");
      }
      const result = await checkGithubCommits({
        criteria: promise.criteria as GithubCriteria,
        deadline: promise.deadline,
        createdAt: promise.createdAt,
      });
      ctx.evidenceSeen = true;
      return result;
    },
  },
  {
    name: "check_image_proof",
    description:
      "Look at the photo attached to the current promise with vision. Use this only when the proof type is image. Returns evidence and a suggestedVerdict.",
    parameters: { type: "object", properties: {} },
    run: async (_args, ctx) => {
      const promise = requirePromise(ctx);
      if (promise.proofType !== "image") throw new Error("This promise is not checked with a photo.");
      const result = await checkImageProof(promise);
      ctx.evidenceSeen = true;
      return result;
    },
  },
  {
    name: "check_strava_activity",
    description:
      "Check a Strava activity for the current promise. Week 2 is a stub: it reports that Strava is not connected and suggests pending. Use this only when the proof type is strava.",
    parameters: { type: "object", properties: {} },
    run: async (_args, ctx) => {
      const promise = requirePromise(ctx);
      if (promise.proofType !== "strava") throw new Error("This promise is not checked with Strava.");
      const result = await checkStravaActivity({
        ...(promise.criteria as StravaCriteria),
        deadline: promise.deadline,
      });
      ctx.evidenceSeen = true;
      return result;
    },
  },
  {
    name: "record_verdict",
    description:
      "Record the final verdict after a proof tool has returned evidence. verdict must be kept, broken, or pending. explanation is two to four sentences that cite the evidence. Call this exactly once.",
    parameters: {
      type: "object",
      properties: {
        verdict: { type: "string", description: "One of kept, broken, or pending." },
        explanation: { type: "string", description: "Why the promise is kept, broken, or still pending. Cite the evidence." },
      },
      required: ["verdict", "explanation"],
    },
    run: async (args, ctx) => {
      if (!ctx.evidenceSeen) throw new Error("Check the proof before recording a verdict.");
      const verdict = String(args.verdict ?? "") as Verdict;
      if (!VERDICTS.includes(verdict)) throw new Error("Verdict must be kept, broken, or pending.");
      const explanation = String(args.explanation ?? "").trim();
      if (explanation.length < 10) throw new Error("Explanation must cite the evidence.");
      ctx.recorded = { verdict, explanation: explanation.slice(0, 2000) };
      return { saved: true, verdict };
    },
  },
];
