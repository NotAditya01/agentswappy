import assert from "node:assert/strict";
import { test } from "node:test";
import { clientIp, takeSendSlot } from "./ratelimit";

function fakeRedis() {
  const store = new Map<string, number>();
  const run = async <T,>(command: (string | number)[]): Promise<T> => {
    const [op, key] = command as [string, string];
    const value = store.get(key) ?? 0;
    if (op === "INCR") store.set(key, value + 1);
    if (op === "DECR") store.set(key, value - 1);
    return (store.get(key) ?? 1) as T;
  };
  return { run, store };
}

const now = Date.UTC(2026, 9, 20, 12, 0);

test("three sends per IP per hour, then 429", async () => {
  const { run } = fakeRedis();
  for (let i = 0; i < 3; i++) assert.ok((await takeSendSlot("1.1.1.1", now, run)).ok);
  const blocked = await takeSendSlot("1.1.1.1", now, run);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.error, /3 sends per hour/);
  assert.ok((await takeSendSlot("1.1.1.1", now + 3_600_000, run)).ok);
});

test("ten sends per day across all IPs", async () => {
  const { run } = fakeRedis();
  for (let i = 0; i < 10; i++) assert.ok((await takeSendSlot(`10.0.0.${i}`, now, run)).ok);
  const blocked = await takeSendSlot("10.0.0.99", now, run);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.error, /10 sends today/);
});

test("a day-limit refusal does not use up the IP's hourly slots", async () => {
  const { run, store } = fakeRedis();
  for (let i = 0; i < 10; i++) await takeSendSlot(`10.0.0.${i}`, now, run);
  await takeSendSlot("2.2.2.2", now, run);
  assert.equal(store.get(`ratelimit:send:ip:2.2.2.2:${Math.floor(now / 3_600_000)}`), 0);
});

test("reads the client IP from forwarded headers", () => {
  assert.equal(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" } })), "9.9.9.9");
  assert.equal(clientIp(new Request("http://x")), "unknown");
});
