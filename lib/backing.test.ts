import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeAbiParameters, encodeEventTopics, type Log } from "viem";
import { findBackingTransfer } from "./backing";
import { usdcAbi } from "./escrow";

const usdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const escrow = "0x0cb3d1093AeD5E812f2f4Fd1a3cF92f93868782d";
const backer = "0xaa04FAbf953199c44f4EDCF724411d9213C8c899";

function transferLog(address: string, from: string, to: string, value: bigint): Log {
  return {
    address,
    topics: encodeEventTopics({ abi: usdcAbi, eventName: "Transfer", args: { from, to } }),
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
  } as unknown as Log;
}

test("finds the backer and amount sent to the escrow", () => {
  const found = findBackingTransfer([transferLog(usdc, backer, escrow, 2_000_000n)], usdc, escrow);
  assert.deepEqual(found, { from: backer, value: 2_000_000n });
});

test("ignores other tokens and other recipients", () => {
  assert.equal(findBackingTransfer([transferLog(backer, backer, escrow, 1n)], usdc, escrow), null);
  assert.equal(findBackingTransfer([transferLog(usdc, backer, backer, 1n)], usdc, escrow), null);
});
