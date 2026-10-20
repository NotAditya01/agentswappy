import assert from "node:assert/strict";
import { test } from "node:test";
import { settleStake } from "./wallet.ts";

const intent = {
  promiseId: "p1",
  verdict: "kept" as const,
  amountUsdc: "1.00",
  makerAddress: "0x1111111111111111111111111111111111111111",
  beneficiaryName: "A friend",
  beneficiaryAddress: "0x2222222222222222222222222222222222222222",
};

test("a promise without an escrow stake is simulated and has no tx hash", async () => {
  const receipt = await settleStake({ ...intent, onchain: null });
  assert.equal(receipt.mocked, true);
  assert.equal(receipt.txHash, null);
});

test("an escrow stake without an agent key falls back to simulated", async () => {
  const previous = process.env.WALLET_PRIVATE_KEY;
  delete process.env.WALLET_PRIVATE_KEY;
  const receipt = await settleStake({
    ...intent,
    onchain: { escrowId: `0x${"ab".repeat(32)}`, createTx: `0x${"cd".repeat(32)}`, maker: intent.makerAddress },
  });
  assert.equal(receipt.mocked, true);
  if (previous) process.env.WALLET_PRIVATE_KEY = previous;
});
