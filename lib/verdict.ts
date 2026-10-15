import type { Verdict } from "./types";

export type VerdictEvidence = {
  verified: boolean;
  goalMet: boolean;
  missingUserProof: boolean;
  suggestedVerdict?: Verdict;
};

/**
 * Map a finished proof check to kept, broken, or pending.
 *
 * Early completion counts as kept. An outage or a missing integration never
 * slashes a stake. A missing photo only breaks the promise after the deadline.
 */
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

/**
 * The agent records a verdict after reading the proof tool.
 * Settlement follows that verdict when it matches the evidence.
 * A mismatch settles with the proof tool so a bad model call cannot move a stake.
 */
export function clampVerdict(
  recorded: Verdict,
  evidence: { verified: boolean; goalMet: boolean; suggestedVerdict: Verdict } | null,
): { verdict: Verdict; clamped: boolean; reason: string | null } {
  if (!evidence || !evidence.verified) {
    if (recorded === "pending") return { verdict: "pending", clamped: false, reason: null };
    return {
      verdict: "pending",
      clamped: true,
      reason: evidence
        ? "the checker could not verify the proof, so nothing is settled"
        : "no proof check was recorded, so nothing is settled",
    };
  }

  if (recorded === evidence.suggestedVerdict) {
    return { verdict: recorded, clamped: false, reason: null };
  }

  const reason =
    evidence.suggestedVerdict === "kept"
      ? "the target is already met"
      : evidence.suggestedVerdict === "pending"
        ? "the promise is still open or cannot be settled yet"
        : "the deadline has passed and the proof does not meet the target";

  return { verdict: evidence.suggestedVerdict, clamped: true, reason };
}
