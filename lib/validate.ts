import { getAddress, isAddress } from "viem";
import type { CreatePromiseInput, PromiseDraft, ProofType } from "./types";

const PROOF_TYPES: ProofType[] = ["github_commits", "image", "strava"];
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

export function parseStake(input: unknown): string | null {
  const trimmed = String(input ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) return null;
  return value.toFixed(2);
}

function cleanText(input: unknown, max: number): string {
  return String(input ?? "").trim().slice(0, max);
}

function parseOptionalIso(input: unknown): string | undefined | null {
  if (input == null || String(input).trim() === "") return undefined;
  const date = new Date(String(input));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function validateCreate(body: unknown): { ok: true; value: CreatePromiseInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Expected a JSON object." };
  const draft = body as PromiseDraft;

  const description = cleanText(draft.description, 500);
  if (description.length < 3) return { ok: false, error: "Describe the promise in at least 3 characters." };

  const deadlineDate = new Date(String(draft.deadline ?? ""));
  if (Number.isNaN(deadlineDate.getTime())) return { ok: false, error: "Deadline must be a valid date." };

  if (!PROOF_TYPES.includes(draft.proofType)) {
    return { ok: false, error: "Proof type must be github_commits, image, or strava." };
  }

  const stakeUsdc = parseStake(draft.stakeUsdc);
  if (!stakeUsdc) return { ok: false, error: "Stake must be a USDC amount greater than 0, with at most 2 decimals." };

  if (!isAddress(String(draft.makerAddress ?? ""))) {
    return { ok: false, error: "Refund address must be an 0x wallet address." };
  }
  if (!isAddress(String(draft.beneficiaryAddress ?? ""))) {
    return { ok: false, error: "Beneficiary address must be an 0x wallet address." };
  }

  const beneficiaryName = cleanText(draft.beneficiaryName, 80);
  if (beneficiaryName.length < 1) return { ok: false, error: "Name the friend or charity who receives a broken stake." };

  const makerAddress = getAddress(draft.makerAddress);
  const beneficiaryAddress = getAddress(draft.beneficiaryAddress);

  if (draft.proofType === "github_commits") {
    const github = draft.github;
    const owner = cleanText(github?.owner, 80);
    const repo = cleanText(github?.repo, 120);
    if (!OWNER.test(owner) || !REPO.test(repo) || repo.includes("..")) {
      return { ok: false, error: "GitHub owner and repo must be a public repository, like vercel/next.js." };
    }
    const minCommits = Number(github?.minCommits);
    if (!Number.isInteger(minCommits) || minCommits < 1 || minCommits > 100_000) {
      return { ok: false, error: "Minimum commits must be a whole number from 1 to 100000." };
    }
    const author = cleanText(github?.author, 39);
    if (author && !OWNER.test(author)) return { ok: false, error: "GitHub author must be a username." };
    const since = parseOptionalIso(github?.since);
    if (since === null) return { ok: false, error: "Commit window start must be a valid date." };

    const criteria = {
      owner,
      repo,
      minCommits,
      ...(author ? { author } : {}),
      ...(since ? { since } : {}),
    };
    const who = author ? ` by @${author}` : "";
    return {
      ok: true,
      value: {
        description,
        deadline: deadlineDate.toISOString(),
        proofType: "github_commits",
        target: `At least ${minCommits} commit${minCommits === 1 ? "" : "s"} on ${owner}/${repo}${who}`,
        stakeUsdc,
        makerAddress,
        beneficiaryName,
        beneficiaryAddress,
        walletStake: draft.walletStake === true,
        criteria,
      },
    };
  }

  if (draft.proofType === "image") {
    const claim = cleanText(draft.image?.claim, 400);
    if (claim.length < 3) return { ok: false, error: "Describe what the photo must show." };
    return {
      ok: true,
      value: {
        description,
        deadline: deadlineDate.toISOString(),
        proofType: "image",
        target: claim,
        stakeUsdc,
        makerAddress,
        beneficiaryName,
        beneficiaryAddress,
        walletStake: draft.walletStake === true,
        criteria: { claim },
      },
    };
  }

  const activity = cleanText(draft.strava?.activity, 40);
  if (activity.length < 2) return { ok: false, error: "Name the Strava activity, such as run or ride." };
  let minDistanceKm: number | undefined;
  if (draft.strava?.minDistanceKm != null && String(draft.strava.minDistanceKm).trim() !== "") {
    minDistanceKm = Number(draft.strava.minDistanceKm);
    if (!Number.isFinite(minDistanceKm) || minDistanceKm <= 0 || minDistanceKm > 1000) {
      return { ok: false, error: "Distance must be a positive number of kilometers." };
    }
  }
  const distance = minDistanceKm ? ` of at least ${minDistanceKm} km` : "";
  return {
    ok: true,
    value: {
      description,
      deadline: deadlineDate.toISOString(),
      proofType: "strava",
      target: `A ${activity}${distance} on Strava`,
      stakeUsdc,
      makerAddress,
      beneficiaryName,
      beneficiaryAddress,
      walletStake: draft.walletStake === true,
      criteria: { activity, ...(minDistanceKm ? { minDistanceKm } : {}) },
    },
  };
}
