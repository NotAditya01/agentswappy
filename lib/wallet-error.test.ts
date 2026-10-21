import assert from "node:assert/strict";
import { test } from "node:test";
import { walletErrorMessage } from "./wallet-error";
import { toChainState } from "./chain-state";

test("wallet errors read plainly", () => {
  assert.match(walletErrorMessage({ code: 4001, message: "User rejected" }), /rejected/);
  assert.match(walletErrorMessage(new Error("ERC20: transfer amount exceeds balance")), /Not enough funds/);
  assert.match(walletErrorMessage(new Error("The current chain of the wallet (id: 1) does not match the target chain")), /wrong network/);
  assert.match(walletErrorMessage(new Error('reverted with custom error "GraceNotOver()"')), /grace/);
  assert.equal(walletErrorMessage(new Error("line one\nline two")), "line one");
});

test("chain state maps the escrow struct", () => {
  const s = toChainState({ deadline: 1000n, status: 4, makerStake: 1_500_000n, backedTotal: 250_000n }, 60n);
  assert.deepEqual(s, { status: "expired", stakeUsdc: "1.5", backedUsdc: "0.25", expiresAt: new Date(1_060_000).toISOString() });
});
