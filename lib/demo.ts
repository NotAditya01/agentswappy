import type { PromiseDraft } from "./types";

export const DEMO_MAKER = "0x1111111111111111111111111111111111111111";
export const DEMO_CHARITY = "0x000000000000000000000000000000000000dEaD";
export const DEMO_FRIEND = "0x2222222222222222222222222222222222222222";

/** Three promises a judge can check immediately. Dates are computed at click time. */
export function buildDemoPromises(now = new Date()): PromiseDraft[] {
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const hourBeforeYesterday = new Date(yesterday.getTime() - 60 * 60 * 1000);

  const shared = {
    makerAddress: DEMO_MAKER,
    beneficiaryName: "Demo charity",
    beneficiaryAddress: DEMO_CHARITY,
  };

  return [
    {
      ...shared,
      description: "Land at least one commit on vercel/next.js during the last 30 days.",
      deadline: yesterday.toISOString(),
      proofType: "github_commits",
      stakeUsdc: "5.00",
      github: { owner: "vercel", repo: "next.js", minCommits: 1, since: monthAgo.toISOString() },
    },
    {
      ...shared,
      description: "Land 5000 commits on vercel/next.js inside a one-hour window yesterday.",
      deadline: yesterday.toISOString(),
      proofType: "github_commits",
      stakeUsdc: "10.00",
      beneficiaryName: "Demo friend",
      beneficiaryAddress: DEMO_FRIEND,
      github: { owner: "vercel", repo: "next.js", minCommits: 5000, since: hourBeforeYesterday.toISOString() },
    },
    {
      ...shared,
      description: "Log a 5 km run on Strava before the deadline.",
      deadline: yesterday.toISOString(),
      proofType: "strava",
      stakeUsdc: "3.00",
      strava: { activity: "run", minDistanceKm: 5 },
    },
  ];
}
