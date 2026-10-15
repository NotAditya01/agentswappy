import type { Verdict } from "./types";

export type VerdictEvidence = {
  verified: boolean;
  goalMet: boolean;
  missingUserProof: boolean;
  suggestedVerdict?: Verdict;
};

export function suggestVerdict(input: {
  now: Date;
  deadline: Date;
  verified: boolean;
  goalMet: boolean;
  missingUserProof: boolean;
}): Verdict {
  if (Number.isNaN(input.deadline.getTime())) return "pending";
  if (input.verified && input.goalMet) return "kept";
  if (!input.verified) return "pending";
  if (input.missingUserProof && input.now.getTime() < input.deadline.getTime()) return "pending";
  if (input.missingUserProof) return "broken";
  if (input.now.getTime() < input.deadline.getTime()) return "pending";
  return "broken";
}

export function verdictFromCheck(input: {
  deadline: string;
  verified: boolean;
  goalMet: boolean;
  missingUserProof: boolean;
  now?: Date;
}): Verdict {
  return suggestVerdict({
    now: input.now ?? new Date(),
    deadline: new Date(input.deadline),
    verified: input.verified,
    goalMet: input.goalMet,
    missingUserProof: input.missingUserProof,
  });
}

export function clampVerdict(
  recorded: Verdict,
  evidence: { verified: boolean } | null,
): { verdict: Verdict; clamped: boolean; reason: string | null } {
  if (evidence?.verified || recorded === "pending") {
    return { verdict: recorded, clamped: false, reason: null };
  }
  return {
    verdict: "pending",
    clamped: true,
    reason: evidence ? "the check did not finish" : "no proof check was recorded",
  };
}
