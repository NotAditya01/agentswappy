import assert from "node:assert/strict";
import { test } from "node:test";
import { attachImageProof, createPromise, getPromise, listPromises, readProofBytes, savePromise, storageKind } from "./store.ts";

const originalFetch = globalThis.fetch;

function fakeUpstash() {
  const hashes = new Map<string, Map<string, string>>();
  const strings = new Map<string, string>();
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://redis.test");
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer secret");
    const [cmd, key, ...args] = JSON.parse(String(init?.body)) as string[];
    calls.push(cmd);
    const hash = hashes.get(key) ?? new Map<string, string>();
    hashes.set(key, hash);
    let result: unknown = null;
    if (cmd === "HSET") result = hash.set(args[0], args[1]) && 1;
    else if (cmd === "HGET") result = hash.get(args[0]) ?? null;
    else if (cmd === "HVALS") result = [...hash.values()];
    else if (cmd === "SET") result = strings.set(key, args[0]) && "OK";
    else if (cmd === "GET") result = strings.get(key) ?? null;
    else if (cmd === "DEL") result = Number(strings.delete(key));
    else return new Response(JSON.stringify({ error: `unknown ${cmd}` }), { status: 400 });
    return new Response(JSON.stringify({ result }), { status: 200 });
  };
  return { calls, strings };
}

test("promises and photos round-trip through Upstash REST when configured", async () => {
  process.env.KV_REST_API_URL = "https://redis.test/";
  process.env.KV_REST_API_TOKEN = "secret";
  const fake = fakeUpstash();
  try {
    assert.equal(storageKind(), "redis");
    const created = await createPromise({
      description: "Read a book",
      deadline: "2026-10-18T00:00:00.000Z",
      proofType: "image",
      target: "A person reading",
      criteria: { claim: "A person reading" },
      stakeUsdc: "5.00",
      makerAddress: "0x1111111111111111111111111111111111111111",
      beneficiaryName: "Friend",
      beneficiaryAddress: "0x2222222222222222222222222222222222222222",
    });
    assert.equal((await getPromise(created.id))?.description, "Read a book");
    assert.equal((await listPromises()).length, 1);

    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const withPhoto = await attachImageProof(created.id, { fileName: "p.png", mimeType: "image/png", bytes });
    assert.ok(withPhoto?.imageProof);
    assert.deepEqual(await readProofBytes(withPhoto.imageProof.storedName), bytes);

    await assert.rejects(
      () => attachImageProof(created.id, { fileName: "big.png", mimeType: "image/png", bytes: Buffer.alloc(800_000) }),
      /700 KB/,
    );

    await savePromise(created.id, { verdict: "kept" });
    assert.equal((await getPromise(created.id))?.verdict, "kept");
    assert.ok(fake.calls.includes("HSET") && fake.calls.includes("SET"));
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
  }
});

test("falls back to the file store without Redis env vars", () => {
  delete process.env.KV_REST_API_URL;
  delete process.env.UPSTASH_REDIS_REST_URL;
  assert.equal(storageKind(), "file");
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "secret";
  assert.equal(storageKind(), "redis");
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});
