import assert from "node:assert/strict";
import { test } from "node:test";
import { callGemini, GEMINI_BUSY, GEMINI_DAILY_QUOTA } from "./model";

test("a used-up daily quota says so instead of retrying", async () => {
  let calls = 0;
  const quota = Object.assign(new Error('{"code":429,"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}'), { status: 429 });
  await assert.rejects(callGemini(async () => { calls++; throw quota; }), { message: GEMINI_DAILY_QUOTA });
  assert.equal(calls, 1);
});

test("a short rate limit is retried once, then reported busy", async () => {
  let calls = 0;
  const limited = Object.assign(new Error("RESOURCE_EXHAUSTED per minute"), { status: 429 });
  await assert.rejects(callGemini(async () => { calls++; throw limited; }), { message: GEMINI_BUSY });
  assert.equal(calls, 2);
});
