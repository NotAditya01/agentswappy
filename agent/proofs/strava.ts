import type { ProofCheckResult, StravaCriteria } from "../../lib/types";

export type StravaQuery = StravaCriteria & { deadline: string };

export interface ActivityProofSource {
  readonly id: "strava";
  isConnected(): boolean;
  check(query: StravaQuery): Promise<ProofCheckResult>;
}

export const stravaProofSource: ActivityProofSource = {
  id: "strava",
  isConnected: () => false,
  async check(query) {
    const distance = query.minDistanceKm ? ` of at least ${query.minDistanceKm} km` : "";
    return {
      provider: "strava",
      verified: false,
      goalMet: false,
      missingUserProof: false,
      suggestedVerdict: "pending",
      summary: `Strava is not connected, so a ${query.activity}${distance} cannot be verified. Week 3 will read activities after OAuth. The stake stays unsettled.`,
      evidence: {
        connected: false,
        week: 3,
        activity: query.activity,
        minDistanceKm: query.minDistanceKm ?? null,
        deadline: query.deadline,
      },
    };
  },
};

export function checkStravaActivity(query: StravaQuery): Promise<ProofCheckResult> {
  return stravaProofSource.check(query);
}
