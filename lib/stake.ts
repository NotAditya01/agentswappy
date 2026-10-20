import type { PromiseRecord } from "./types";

export const STAKE_NOT_CONFIRMED = "The stake is not confirmed yet. Wait for the escrow transaction, then check again.";

export function stakeUnconfirmed(promise: PromiseRecord): boolean {
  return Boolean(promise.walletStake && !promise.onchain);
}

export function needsOnchainSettle(promise: PromiseRecord): boolean {
  const decided = promise.verdict === "kept" || promise.verdict === "broken";
  return decided && Boolean(promise.onchain) && (!promise.settlement || promise.settlement.mocked);
}
