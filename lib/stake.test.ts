import assert from "node:assert/strict";
import { test } from "node:test";
import { needsOnchainSettle, stakeUnconfirmed } from "./stake.ts";
import type { PromiseRecord, SettlementReceipt } from "./types.ts";

const onchain = { escrowId: `0x${"ab".repeat(32)}`, createTx: `0x${"cd".repeat(32)}`, maker: "0x1111111111111111111111111111111111111111" } as const;
const mocked = { mocked: true, txHash: null } as SettlementReceipt;

function promise(patch: Partial<PromiseRecord>): PromiseRecord {
  return { id: "p1", verdict: null, settlement: null, onchain: null, walletStake: false, ...patch } as PromiseRecord;
}

test("a wallet stake without a confirmed escrow tx blocks the check", () => {
  assert.equal(stakeUnconfirmed(promise({ walletStake: true })), true);
  assert.equal(stakeUnconfirmed(promise({ walletStake: true, onchain })), false);
  assert.equal(stakeUnconfirmed(promise({})), false);
});

test("a simulated verdict on a confirmed stake gets settled on chain", () => {
  assert.equal(needsOnchainSettle(promise({ verdict: "kept", settlement: mocked, onchain })), true);
  assert.equal(needsOnchainSettle(promise({ verdict: "broken", settlement: { ...mocked, mocked: false }, onchain })), false);
  assert.equal(needsOnchainSettle(promise({ verdict: "kept", settlement: mocked })), false);
  assert.equal(needsOnchainSettle(promise({ verdict: "pending", onchain })), false);
});
