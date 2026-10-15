import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { MODEL } from "../model.ts";
import { checkImageProof } from "./image.ts";
import { proofFilePath } from "../../lib/store.ts";
import type { PromiseRecord } from "../../lib/types.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const originalFetch = globalThis.fetch;
const previousKey = process.env.GEMINI_API_KEY;

function promiseWithPhoto(storedName: string): PromiseRecord {
  return {
    id: "photo-1",
    description: "Show a tiny picture",
    deadline: "2026-10-14T00:00:00.000Z",
    proofType: "image",
    target: "A one pixel image",
    criteria: { claim: "A one pixel image" },
    stakeUsdc: "5.00",
    makerAddress: "0x1111111111111111111111111111111111111111",
    beneficiaryName: "A friend",
    beneficiaryAddress: "0x2222222222222222222222222222222222222222",
    status: "open",
    verdict: null,
    explanation: null,
    decidedBy: null,
    trace: [],
    settlement: null,
    imageProof: {
      fileName: "pixel.png",
      mimeType: "image/png",
      storedName,
      bytes: PNG.length,
      uploadedAt: "2026-10-14T00:00:00.000Z",
    },
    createdAt: "2026-10-01T00:00:00.000Z",
    checkedAt: null,
    checkingStartedAt: null,
  };
}

describe("photo proof", { concurrency: 1 }, () => {
test("photo check sends the image bytes to Gemini vision", async () => {
  const storedName = `pixel-${crypto.randomUUID()}.png`;
  const full = proofFilePath(storedName);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, PNG);
  process.env.GEMINI_API_KEY = "test-key";

  let sawImage = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? init.body : "";
    assert.match(url, new RegExp(`models/${MODEL}:generateContent`));
    assert.match(body, /inlineData/);
    assert.match(body, /image\/png/);
    assert.ok(body.includes(PNG.toString("base64")));
    sawImage = true;
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: '{"matches":true,"confidence":0.91,"observation":"A single red pixel."}' }],
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const result = await checkImageProof(promiseWithPhoto(storedName));
    assert.equal(sawImage, true);
    assert.equal(result.verified, true);
    assert.equal(result.evidence.sentToVision, true);
    assert.equal(result.evidence.bytesSent, PNG.length);
    assert.equal(result.evidence.model, MODEL);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
    await fs.rm(full, { force: true });
  }
});

test("a Gemini vision error is thrown instead of a rule verdict", async () => {
  const storedName = `pixel-${crypto.randomUUID()}.png`;
  const full = proofFilePath(storedName);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, PNG);
  process.env.GEMINI_API_KEY = "test-key";
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "model unavailable" } }), { status: 400 });

  try {
    await assert.rejects(() => checkImageProof(promiseWithPhoto(storedName)), /Gemini could not look at the photo/);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
    await fs.rm(full, { force: true });
  }
});

test("photo check without a key throws", async () => {
  delete process.env.GEMINI_API_KEY;
  try {
    await assert.rejects(() => checkImageProof(promiseWithPhoto("missing.png")), /GEMINI_API_KEY/);
  } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});
});
