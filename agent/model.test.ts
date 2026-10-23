import assert from "node:assert/strict";
import { test } from "node:test";
import { callGemini, GEMINI_BUSY, GEMINI_DAILY_QUOTA, modelChain } from "./model";

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

test("geminiFailure does not repeat the settled note", async () => {
  const { geminiFailure } = await import("./model");
  const err = geminiFailure("Gemini could not look at the photo.", new Error("Quota used up. Nothing was settled."));
  assert.equal(err.message.match(/Nothing was settled/g)?.length, 1);
});

const dailyQuota = () => Object.assign(new Error('{"code":429,"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}'), { status: 429 });

test("the model chain is primary first, then the optional fallback", () => {
  assert.deepEqual(modelChain({ GEMINI_MODEL: "a" }), ["a"]);
  assert.deepEqual(modelChain({ GEMINI_MODEL: "a", GEMINI_FALLBACK_MODEL: "b" }), ["a", "b"]);
  assert.deepEqual(modelChain({ GEMINI_MODEL: "a", GEMINI_FALLBACK_MODEL: "a" }), ["a"]);
});

test("a used-up daily quota moves on to the fallback model", async () => {
  const tried: string[] = [];
  const out = await callGemini(async (_s, model) => {
    tried.push(model);
    if (model === "primary") throw dailyQuota();
    return "ok";
  }, undefined, ["primary", "fallback"]);
  assert.equal(out, "ok");
  assert.deepEqual(tried, ["primary", "fallback"]);
});

test("other errors do not jump to the fallback", async () => {
  const tried: string[] = [];
  await assert.rejects(callGemini(async (_s, model) => {
    tried.push(model);
    throw new Error("bad request");
  }, undefined, ["primary", "fallback"]), /bad request/);
  assert.deepEqual(tried, ["primary"]);
});

test("when every model is out of quota, the quota message is shown", async () => {
  await assert.rejects(callGemini(async () => { throw dailyQuota(); }, undefined, ["a", "b"]), { message: GEMINI_DAILY_QUOTA });
});
