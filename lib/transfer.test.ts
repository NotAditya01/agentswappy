import assert from "node:assert/strict";
import { test } from "node:test";
import { overAgentCap, promptNamesOtherChain, validateTransfer, wrongNetwork } from "./transfer";

const to = "0xaa04fabf953199c44f4edcf724411d9213c8c899";

test("accepts a USDC transfer and checksums the address", () => {
  const result = validateTransfer({ token: "usdc", amount: "5", to });
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.transfer.token, "USDC");
    assert.equal(result.transfer.to, "0xaa04FAbf953199c44f4EDCF724411d9213C8c899");
  }
});

test("rejects bad amounts", () => {
  for (const amount of ["0", "-1", "abc", "1e3", "", "0.0000001"]) {
    assert.equal(validateTransfer({ token: "USDC", amount, to }).ok, false, amount);
  }
  assert.ok(validateTransfer({ token: "ETH", amount: "0.000000000000000001", to }).ok);
});

test("rejects bad recipients and other tokens", () => {
  assert.equal(validateTransfer({ token: "USDC", amount: "1", to: "0x123" }).ok, false);
  assert.equal(validateTransfer({ token: "USDC", amount: "1", to: `0x${"0".repeat(40)}` }).ok, false);
  assert.equal(validateTransfer({ token: "DAI", amount: "1", to }).ok, false);
});

test("rejects other networks", () => {
  assert.equal(validateTransfer({ token: "USDC", amount: "1", to, network: "Ethereum mainnet" }).ok, false);
  assert.equal(validateTransfer({ token: "USDC", amount: "1", to, network: "polygon" }).ok, false);
  assert.ok(validateTransfer({ token: "USDC", amount: "1", to, network: "Base Sepolia" }).ok);
  assert.equal(wrongNetwork(""), false);
  assert.ok(promptNamesOtherChain("send 1 usdc to 0xabc on mainnet"));
  assert.ok(promptNamesOtherChain("send 1 usdc on arbitrum"));
  assert.equal(promptNamesOtherChain("send 1 usdc to 0xabc on base sepolia"), false);
  assert.equal(promptNamesOtherChain("send 0.001 ETH to 0xabc"), false);
});

test("agent cap is 2 USDC and 0.001 ETH", () => {
  const ok = (token: string, amount: string) => {
    const r = validateTransfer({ token, amount, to });
    if (!r.ok) throw new Error(r.error);
    return r.transfer;
  };
  assert.equal(overAgentCap(ok("USDC", "2")), false);
  assert.equal(overAgentCap(ok("USDC", "2.000001")), true);
  assert.equal(overAgentCap(ok("ETH", "0.001")), false);
  assert.equal(overAgentCap(ok("ETH", "0.0011")), true);
});
