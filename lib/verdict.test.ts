import assert from "node:assert/strict";
import test from "node:test";
import { clampVerdict, suggestVerdict } from "./verdict.ts";

const deadline = new Date("2026-10-14T12:00:00.000Z");
const before = new Date("2026-10-13T12:00:00.000Z");
const after = new Date("2026-10-15T12:00:00.000Z");

test("a met goal is kept even before the deadline", () => {
  assert.equal(
    suggestVerdict({ now: before, deadline, verified: true, goalMet: true, missingUserProof: false }),
    "kept",
  );
});

test("an unmet goal before the deadline stays pending", () => {
  assert.equal(
    suggestVerdict({ now: before, deadline, verified: true, goalMet: false, missingUserProof: false }),
    "pending",
  );
});

test("an unmet goal after the deadline is broken", () => {
  assert.equal(
    suggestVerdict({ now: after, deadline, verified: true, goalMet: false, missingUserProof: false }),
    "broken",
  );
});

test("an outage never slashes the stake", () => {
  assert.equal(
    suggestVerdict({ now: after, deadline, verified: false, goalMet: false, missingUserProof: false }),
    "pending",
  );
});

test("a missing photo is pending before the deadline and broken after", () => {
  assert.equal(
    suggestVerdict({ now: before, deadline, verified: true, goalMet: false, missingUserProof: true }),
    "pending",
  );
  assert.equal(
    suggestVerdict({ now: after, deadline, verified: true, goalMet: false, missingUserProof: true }),
    "broken",
  );
});

test("clamp keeps a matching agent verdict", () => {
  const result = clampVerdict("broken", { verified: true, goalMet: false, suggestedVerdict: "broken" });
  assert.deepEqual(result, { verdict: "broken", clamped: false, reason: null });
});

test("clamp refuses to settle when the checker could not verify", () => {
  const result = clampVerdict("broken", { verified: false, goalMet: false, suggestedVerdict: "pending" });
  assert.equal(result.verdict, "pending");
  assert.equal(result.clamped, true);
});

test("clamp follows the proof tool when the agent disagrees", () => {
  const result = clampVerdict("pending", { verified: true, goalMet: false, suggestedVerdict: "broken" });
  assert.equal(result.verdict, "broken");
  assert.equal(result.clamped, true);
});
