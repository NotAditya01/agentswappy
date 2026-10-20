import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseFundPath, isUserRejection, supportsAtomicBatch } from "./fund-path";

const both = { usdcHasPermit: true, escrowHasPermit: true };

test("smart wallets with atomic batching get one prompt", () => {
  assert.equal(chooseFundPath({ capabilities: { atomic: { status: "supported" } }, ...both }), "batch");
  assert.equal(chooseFundPath({ capabilities: { atomic: { status: "ready" } }, ...both }), "batch");
  assert.equal(chooseFundPath({ capabilities: { atomicBatch: { supported: true } }, ...both }), "batch");
});

test("no batching falls back to permit when both contracts support it", () => {
  assert.equal(chooseFundPath({ capabilities: null, ...both }), "permit");
  assert.equal(chooseFundPath({ capabilities: { atomic: { status: "unsupported" } }, ...both }), "permit");
});

test("no permit on either side falls back to approve then create", () => {
  assert.equal(chooseFundPath({ capabilities: {}, usdcHasPermit: true, escrowHasPermit: false }), "approve");
  assert.equal(chooseFundPath({ capabilities: undefined, usdcHasPermit: false, escrowHasPermit: true }), "approve");
});

test("capability checks and rejections", () => {
  assert.equal(supportsAtomicBatch({ atomicBatch: { supported: false } }), false);
  assert.ok(isUserRejection({ code: 4001 }));
  assert.ok(isUserRejection({ name: "UserRejectedRequestError" }));
  assert.equal(isUserRejection(new Error("method not supported")), false);
});
