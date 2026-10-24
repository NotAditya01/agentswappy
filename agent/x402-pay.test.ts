import assert from "node:assert/strict";
import { test } from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { backingRequirements, decodePayment, matchesRequirements, type PaymentRequirements } from "../lib/x402.ts";
import { agentBack, checkQuote, overAgentBackingCap, type PayStep } from "./x402-pay.ts";

const escrow = "0x0cb3d1093AeD5E812f2f4Fd1a3cF92f93868782d";
const origin = "https://pop.test";
const settleTx = `0x${"ab".repeat(32)}`;
const creditTx = `0x${"cd".repeat(32)}`;

// A tiny stand-in for the /back endpoint with the facilitator mocked out.
function fakeEndpoint(opts: { tamper?: (req: PaymentRequirements) => PaymentRequirements } = {}) {
  const calls: { url: string; payment: string | null }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const payment = headers.get("x-payment");
    calls.push({ url, payment });
    const amount = new URL(url).searchParams.get("amount")!;
    let req = backingRequirements({ amountUsdc: amount, resource: url, payTo: escrow });
    if (opts.tamper) req = opts.tamper(req);
    if (!payment) return Response.json({ x402Version: 1, error: "X-PAYMENT header is required", accepts: [req] }, { status: 402 });
    const decoded = decodePayment(payment);
    if (!decoded || !matchesRequirements(decoded, req)) return Response.json({ error: "bad payment", accepts: [req] }, { status: 402 });
    const from = decoded.payload.authorization.from;
    const receipt = btoa(JSON.stringify({ success: true, transaction: settleTx, network: "base-sepolia", payer: from }));
    return Response.json(
      { id: "p1", backings: [{ backer: from, amountUsdc: amount, txHash: settleTx, creditTx, at: "now", via: "x402" }] },
      { headers: { "X-PAYMENT-RESPONSE": receipt } },
    );
  }) as typeof fetch;
  return { fetchImpl, calls };
}

test("agent backing is capped at 2 USDC", async () => {
  assert.equal(overAgentBackingCap("2"), false);
  assert.equal(overAgentBackingCap("2.01"), true);
  const { fetchImpl, calls } = fakeEndpoint();
  const account = privateKeyToAccount(generatePrivateKey());
  await assert.rejects(agentBack({ promiseId: "p1", amountUsdc: "2.5", origin, escrow, account, fetchImpl }), /at most 2 USDC/);
  assert.equal(calls.length, 0, "nothing is requested over the cap");
});

test("agent gets a 402, signs from its own wallet, and returns both txs", async () => {
  const { fetchImpl, calls } = fakeEndpoint();
  const account = privateKeyToAccount(generatePrivateKey());
  const steps: PayStep["step"][] = [];
  const result = await agentBack({ promiseId: "p1", amountUsdc: "0.1", origin, escrow, account, fetchImpl, onStep: (s) => steps.push(s.step) });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].payment, null);
  assert.ok(calls[1].payment);
  assert.equal(decodePayment(calls[1].payment)!.payload.authorization.from, account.address);
  assert.equal(decodePayment(calls[1].payment)!.payload.authorization.value, "100000");
  assert.equal(result.paymentTx, settleTx);
  assert.equal(result.creditTx, creditTx);
  assert.equal(result.payer, account.address);
  assert.deepEqual(steps, ["quote", "signed", "paying", "settled"]);
});

test("agent refuses to sign a quote that pays someone else or asks for more", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const other = "0xaa04FAbf953199c44f4EDCF724411d9213C8c899";
  const elsewhere = fakeEndpoint({ tamper: (r) => ({ ...r, payTo: other }) });
  await assert.rejects(agentBack({ promiseId: "p1", amountUsdc: "0.1", origin, escrow, account, fetchImpl: elsewhere.fetchImpl }), /other than the escrow/);
  assert.equal(elsewhere.calls.length, 1, "never retried with a payment");
  const pricier = fakeEndpoint({ tamper: (r) => ({ ...r, maxAmountRequired: "1000000" }) });
  await assert.rejects(agentBack({ promiseId: "p1", amountUsdc: "0.1", origin, escrow, account, fetchImpl: pricier.fetchImpl }), /different amount/);
  assert.throws(() => checkQuote({ ...backingRequirements({ amountUsdc: "0.1", resource: "x", payTo: escrow }), network: "base" }, "0.1", escrow), /another network/);
});
