import { test } from "node:test";
import assert from "node:assert/strict";
import { hiddenIds, visible } from "./hidden";
import { statsOf } from "./stats";
import type { PromiseRecord } from "./types";

test("hides listed test promises and extra env ids", () => {
  const hidden = hiddenIds("abc, def");
  assert.ok(hidden.has("a83dd254-1a22-4da1-963c-07abdaf947b7"));
  const list = [{ id: "abc" }, { id: "keep" }, { id: "def" }];
  assert.deepEqual(visible(list, hidden), [{ id: "keep" }]);
});

test("stats count open locked USDC, kept promises and backers", () => {
  const list = [
    { id: "1", verdict: null, chain: { status: "open", stakeUsdc: "0.2", backedUsdc: "0.1", expiresAt: "" }, backings: [{}] },
    { id: "2", verdict: "kept", chain: { status: "kept", stakeUsdc: "1", backedUsdc: "0", expiresAt: "" }, backings: [{}, {}] },
    { id: "3", verdict: null },
  ] as unknown as PromiseRecord[];
  assert.deepEqual(statsOf(list), { lockedUsdc: 0.3, kept: 1, backers: 3 });
  assert.deepEqual(statsOf([]), { lockedUsdc: 0, kept: 0, backers: 0 });
});
