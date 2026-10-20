import assert from "node:assert/strict";
import { test } from "node:test";
import { findPromise, toIntent } from "./intent";
import type { PromiseRecord } from "./types";

const now = Date.UTC(2026, 9, 20, 15, 0);
const later = new Date(now + 3 * 86_400_000).toISOString();
const addr = "0xaa04fabf953199c44f4edcf724411d9213c8c899";

function promise(id: string, description: string, extra: Partial<PromiseRecord> = {}): PromiseRecord {
  return {
    id, description, deadline: later, proofType: "github_commits", target: "", criteria: { kind: "github_commits" } as never,
    stakeUsdc: "1.00", makerAddress: addr, beneficiaryName: "A friend", beneficiaryAddress: addr, status: "open",
    verdict: null, explanation: null, decidedBy: null, trace: [], settlement: null, imageProof: null,
    createdAt: "", checkedAt: null, checkingStartedAt: null,
    onchain: { escrowId: "0x01", createTx: "0x02", maker: addr } as never, ...extra,
  };
}

const list = [
  promise("aaaa-1111", "Push 3 commits to NotAditya01/agentswappy"),
  promise("bbbb-2222", "Run 5km on Sunday"),
  promise("cccc-3333", "Push docs to kestra", { onchain: null }),
];

test("create_promise fills the form fields", () => {
  const intent = toIntent(
    { intent: "create_promise", description: "Push 3 commits", deadline: later, repo: "https://github.com/a/b/", minCommits: 3, stake: "1", beneficiaryAddress: addr },
    [], now,
  );
  assert.equal(intent.kind, "create_promise");
  if (intent.kind === "create_promise") {
    assert.equal(intent.prefill.repo, "a/b");
    assert.equal(intent.prefill.minCommits, "3");
    assert.equal(intent.prefill.stakeUsdc, "1.00");
    assert.equal(intent.prefill.beneficiaryAddress, "0xaa04FAbf953199c44f4EDCF724411d9213C8c899");
  }
});

test("create_promise asks when the deadline is missing or past", () => {
  assert.equal(toIntent({ intent: "create_promise", description: "x", deadline: "" }, [], now).kind, "clarify");
  assert.equal(toIntent({ intent: "create_promise", description: "x", deadline: "2020-01-01" }, [], now).kind, "clarify");
});

test("back_promise resolves by id or title", () => {
  const byId = toIntent({ intent: "back_promise", target: "bbbb", amount: "2" }, list, now);
  assert.equal(byId.kind === "back_promise" && byId.promise.id, "bbbb-2222");
  const byTitle = toIntent({ intent: "back_promise", target: "agentswappy commits", amount: "2" }, list, now);
  assert.equal(byTitle.kind === "back_promise" && byTitle.amountUsdc, "2.00");
  const loose = toIntent({ intent: "back_promise", target: "the agentswappy commits promise", amount: "1" }, list, now);
  assert.equal(loose.kind === "back_promise" && loose.promise.id, "aaaa-1111");
});

test("back_promise asks when it is ambiguous, unknown or not in the escrow", () => {
  assert.equal(findPromise("push", list).length, 2);
  assert.equal(toIntent({ intent: "back_promise", target: "push", amount: "2" }, list, now).kind, "clarify");
  assert.equal(toIntent({ intent: "back_promise", target: "swim", amount: "2" }, list, now).kind, "clarify");
  const noEscrow = toIntent({ intent: "back_promise", target: "kestra", amount: "2" }, list, now);
  assert.ok(noEscrow.kind === "clarify" && /no stake in the escrow/.test(noEscrow.question));
});

test("send keeps transfer validation", () => {
  assert.equal(toIntent({ intent: "send", token: "USDC", amount: "1", to: addr }, [], now).kind, "send");
  assert.equal(toIntent({ intent: "send", token: "USDC", amount: "1", to: addr, network: "polygon" }, [], now).kind, "clarify");
});

test("anything else gets a short question", () => {
  const intent = toIntent({ intent: "unclear", question: "Did you mean to send or back?" }, [], now);
  assert.deepEqual(intent, { kind: "clarify", question: "Did you mean to send or back?" });
});
