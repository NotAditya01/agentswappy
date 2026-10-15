import type { GithubCriteria, PromiseRecord, ProofCheckResult, StravaCriteria } from "../../lib/types";
import { checkGithubCommits } from "./github";
import { checkImageProof } from "./image";
import { checkStravaActivity } from "./strava";

export async function checkProof(promise: PromiseRecord): Promise<ProofCheckResult> {
  if (promise.proofType === "github_commits") {
    return checkGithubCommits({
      criteria: promise.criteria as GithubCriteria,
      deadline: promise.deadline,
      createdAt: promise.createdAt,
    });
  }
  if (promise.proofType === "image") return checkImageProof(promise);
  return checkStravaActivity({ ...(promise.criteria as StravaCriteria), deadline: promise.deadline });
}

export function proofToolName(promise: PromiseRecord): string {
  if (promise.proofType === "github_commits") return "check_github_commits";
  if (promise.proofType === "image") return "check_image_proof";
  return "check_strava_activity";
}
