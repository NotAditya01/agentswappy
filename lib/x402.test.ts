import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyTypedData } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { backingRequirements, decodePayment, matchesRequirements, parseBackingAmount, signPayment } from "./x402.ts";

const escrow = "0x0cb3d1093AeD5E812f2f4Fd1a3cF92f93868782d";
const req = backingRequirements({ amountUsdc: "0.25", resource: "https://x.test/api/promises/p1/back?amount=0.25", payTo: escrow });

test("backing amounts stay small", () => {
  assert.equal(parseBackingAmount("0.5"), "0.5");
  assert.equal(parseBackingAmount("5"), "5");
  assert.equal(parseBackingAmount("0.001"), null);
  assert.equal(parseBackingAmount("5.01"), null);
  assert.equal(parseBackingAmount("-1"), null);
  assert.equal(parseBackingAmount("abc"), null);
});

test("requirements ask for exact USDC to the escrow on base-sepolia", () => {
  assert.equal(req.maxAmountRequired, "250000");
  assert.equal(req.payTo, escrow);
  assert.equal(req.network, "base-sepolia");
  assert.deepEqual(req.extra, { name: "USDC", version: "2" });
});

test("a signed payment decodes, matches, and verifies as an EIP-3009 authorization", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const header = await signPayment(account, account.address, req);
  const payment = decodePayment(header);
  assert.ok(payment);
  assert.equal(matchesRequirements(payment, req), true);
  const auth = payment.payload.authorization;
  const ok = await verifyTypedData({
    address: account.address,
    domain: { name: "USDC", version: "2", chainId: 84532, verifyingContract: req.asset },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: { ...auth, value: BigInt(auth.value), validAfter: BigInt(auth.validAfter), validBefore: BigInt(auth.validBefore) },
    signature: payment.payload.signature,
  });
  assert.equal(ok, true);
});

test("a payment for a different amount or recipient does not match", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const other = backingRequirements({ amountUsdc: "0.1", resource: req.resource, payTo: escrow });
  const payment = decodePayment(await signPayment(account, account.address, other))!;
  assert.equal(matchesRequirements(payment, req), false);
});

test("junk headers are rejected", () => {
  assert.equal(decodePayment(null), null);
  assert.equal(decodePayment("not base64 json"), null);
  assert.equal(decodePayment(btoa(JSON.stringify({ x402Version: 2 }))), null);
});
