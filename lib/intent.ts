import { getAddress, isAddress } from "viem";
import { validateTransfer, type Transfer } from "./transfer";
import type { PromiseRecord, ProofType } from "./types";
import { parseStake } from "./validate";

export type PromisePrefill = {
  description: string;
  deadline: string;
  proofType: ProofType;
  stakeUsdc: string;
  beneficiaryName: string;
  beneficiaryAddress: string;
  repo: string;
  minCommits: string;
  claim: string;
};

export type BackTarget = { id: string; description: string; deadline: string; escrowId: string | null };

export type Intent =
  | { kind: "create_promise"; prefill: PromisePrefill }
  | { kind: "back_promise"; promise: BackTarget; amountUsdc: string }
  | { kind: "send"; transfer: Transfer }
  | { kind: "clarify"; question: string };

const clarify = (question: string): Intent => ({ kind: "clarify", question });
const text = (value: unknown, max = 300) => String(value ?? "").trim().slice(0, max);

// Finds the promise a "back ..." request means: an exact id first, then words from the description.
export function findPromise(target: string, promises: PromiseRecord[]): PromiseRecord[] {
  const wanted = target.trim().toLowerCase();
  if (!wanted) return [];
  const byId = promises.filter((p) => p.id.toLowerCase() === wanted || p.id.toLowerCase().startsWith(wanted));
  if (byId.length) return byId;
  const exact = promises.filter((p) => p.description.toLowerCase() === wanted);
  if (exact.length) return exact;
  const words = wanted.split(/\s+/).filter((w) => w.length > 2);
  if (!words.length) return [];
  return promises.filter((p) => words.every((w) => p.description.toLowerCase().includes(w)));
}

export function toIntent(raw: Record<string, unknown>, promises: PromiseRecord[], now = Date.now()): Intent {
  const kind = text(raw.intent);

  if (kind === "send") {
    const checked = validateTransfer({ token: raw.token, amount: raw.amount, to: raw.to, network: raw.network });
    return checked.ok ? { kind: "send", transfer: checked.transfer } : clarify(checked.error);
  }

  if (kind === "back_promise") {
    const amountUsdc = parseStake(raw.amount);
    if (!amountUsdc) return clarify("How much USDC do you want to back it with?");
    const target = text(raw.target, 200);
    if (!target) return clarify("Which promise do you want to back? Use its title or id.");
    const matches = findPromise(target, promises);
    if (matches.length === 0) return clarify(`I could not find a promise matching "${target}". Use its title or id.`);
    if (matches.length > 1) {
      return clarify(`More than one promise matches: ${matches.slice(0, 3).map((p) => `"${p.description}"`).join(", ")}. Which one?`);
    }
    const [p] = matches;
    if (!p.onchain) return clarify(`"${p.description}" has no stake in the escrow, so it can't be backed.`);
    if (p.status === "resolved" || new Date(p.deadline).getTime() <= now) {
      return clarify(`"${p.description}" is already past its deadline or settled, so it can't be backed.`);
    }
    return {
      kind: "back_promise",
      amountUsdc,
      promise: { id: p.id, description: p.description, deadline: p.deadline, escrowId: p.onchain.escrowId },
    };
  }

  if (kind === "create_promise") {
    const description = text(raw.description);
    if (!description) return clarify("What do you promise to do?");
    const deadline = new Date(text(raw.deadline));
    if (Number.isNaN(deadline.getTime())) return clarify("By when? Give a date or a day, like Friday 6pm.");
    if (deadline.getTime() <= now) return clarify("That deadline is already in the past. When should it be?");

    const repo = text(raw.repo, 140).replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\/$/, "");
    const claim = text(raw.claim);
    const proofType: ProofType = repo ? "github_commits" : "image";
    if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) return clarify("Which GitHub repo? Write it as owner/repo.");

    const stakeUsdc = raw.stake == null || text(raw.stake) === "" ? "1.00" : parseStake(raw.stake);
    if (!stakeUsdc) return clarify("How much USDC do you want to stake?");

    const payTo = text(raw.beneficiaryAddress, 60);
    if (payTo && !isAddress(payTo, { strict: false })) return clarify("The address to pay if you break it is not a valid 0x address.");

    const commits = Number(raw.minCommits);
    return {
      kind: "create_promise",
      prefill: {
        description,
        deadline: deadline.toISOString(),
        proofType,
        stakeUsdc,
        beneficiaryName: text(raw.beneficiaryName, 60) || "A friend",
        beneficiaryAddress: payTo ? getAddress(payTo) : "",
        repo,
        minCommits: Number.isInteger(commits) && commits > 0 ? String(commits) : "1",
        claim: proofType === "image" ? claim || description : "",
      },
    };
  }

  return clarify(text(raw.question) || "Do you want to make a promise, back one, or send tokens?");
}
