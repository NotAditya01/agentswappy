import { test } from "node:test";
import assert from "node:assert/strict";
import { gradientFor, progressOf, statusOf } from "./status";
import type { PromiseRecord } from "./types";

const base = { createdAt: "2026-10-01T00:00:00Z", deadline: "2026-10-11T00:00:00Z", verdict: null } as unknown as PromiseRecord;
const mid = new Date("2026-10-06T00:00:00Z").getTime();
const after = new Date("2026-10-12T00:00:00Z").getTime();

test("status and progress follow the deadline", () => {
  assert.equal(statusOf(base, mid), "Open");
  assert.equal(statusOf(base, after), "Check proof");
  assert.equal(statusOf({ ...base, verdict: "pending" }, after), "Overdue");
  assert.equal(statusOf({ ...base, verdict: "kept" }, after), "Kept");
  assert.equal(progressOf(base, mid), 0.5);
  assert.equal(gradientFor("0xAbc"), gradientFor("0xabc"));
});
