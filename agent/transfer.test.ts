import assert from "node:assert/strict";
import { test } from "node:test";
import { readParsed, sendFromAgent } from "./transfer";

const to = "0xaa04FAbf953199c44f4EDCF724411d9213C8c899";

test("reads the model JSON into a checked transfer", () => {
  const result = readParsed(JSON.stringify({ token: "USDC", amount: "5", to, network: "" }));
  assert.ok(result.ok);
});

test("passes on model refusals and bad JSON", () => {
  assert.deepEqual(readParsed('{"error":"not a transfer"}'), { ok: false, error: "not a transfer" });
  assert.equal(readParsed("nope").ok, false);
  assert.equal(readParsed(JSON.stringify({ token: "USDC", amount: "1", to, network: "Ethereum" })).ok, false);
});

test("agent refuses to send over the cap before touching the chain", async () => {
  const saved = process.env.WALLET_PRIVATE_KEY;
  process.env.WALLET_PRIVATE_KEY = `0x${"11".repeat(32)}`;
  try {
    await assert.rejects(sendFromAgent({ token: "USDC", amount: "2.5", to, network: "base-sepolia" }), /at most 2 USDC/);
    await assert.rejects(sendFromAgent({ token: "ETH", amount: "0.002", to, network: "base-sepolia" }), /at most 0.001 ETH/);
  } finally {
    if (saved === undefined) delete process.env.WALLET_PRIVATE_KEY;
    else process.env.WALLET_PRIVATE_KEY = saved;
  }
});
