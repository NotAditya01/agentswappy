import { test } from "node:test";
import assert from "node:assert/strict";
import { activityMatches, freshTokens, makeState, matchActivities, readState, type StravaActivity } from "../../lib/strava";
import { checkStravaActivity } from "./strava";

const act = (id: number, sport: string, km: number, start = "2026-10-20T06:00:00Z"): StravaActivity => ({
  id,
  name: `${sport} ${id}`,
  type: sport.includes("Run") ? "Run" : sport.includes("Ride") ? "Ride" : sport,
  sport_type: sport,
  distance: km * 1000,
  start_date: start,
});

test("activity types match with aliases", () => {
  assert.equal(activityMatches("run", act(1, "Run", 5)), true);
  assert.equal(activityMatches("Running", act(1, "TrailRun", 5)), true);
  assert.equal(activityMatches("cycling", act(1, "GravelRide", 5)), true);
  assert.equal(activityMatches("run", act(1, "Ride", 5)), false);
  assert.equal(activityMatches("swim", act(1, "Walk", 5)), false);
});

test("distance and count are both enforced", () => {
  const list = [act(1, "Run", 4.9), act(2, "Run", 5.2), act(3, "Ride", 30), act(4, "Run", 10)];
  const one = matchActivities(list, { activity: "run", minDistanceKm: 5 });
  assert.equal(one.goalMet, true);
  assert.deepEqual(one.qualifying.map((a) => a.id), [2, 4]);
  assert.equal(one.sameType, 3);
  assert.equal(matchActivities(list, { activity: "run", minDistanceKm: 5, minCount: 3 }).goalMet, false);
  assert.equal(matchActivities(list, { activity: "run", minCount: 3 }).goalMet, true);
  assert.equal(matchActivities([], { activity: "run" }).goalMet, false);
});

test("state is signed and rejects tampering", () => {
  const state = makeState("abc", "secret");
  assert.equal(readState(state, "secret"), "abc");
  assert.equal(readState(state.replace("abc", "xyz"), "secret"), null);
  assert.equal(readState(state, "other"), null);
  assert.equal(readState("junk", "secret"), null);
});

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const old: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    old[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  return fn().finally(() => {
    for (const k of Object.keys(old)) {
      if (old[k] === undefined) delete process.env[k];
      else process.env[k] = old[k];
    }
  });
}

const ENV = {
  STRAVA_CLIENT_ID: "1",
  STRAVA_CLIENT_SECRET: "s",
  KV_REST_API_URL: "https://redis.test",
  KV_REST_API_TOKEN: "t",
  UPSTASH_REDIS_REST_URL: undefined,
  UPSTASH_REDIS_REST_TOKEN: undefined,
};

test("not configured returns pending without calling Strava", async () => {
  await withEnv({ STRAVA_CLIENT_ID: undefined, STRAVA_CLIENT_SECRET: undefined }, async () => {
    const res = await checkStravaActivity({
      activity: "run",
      promiseId: "p",
      createdAt: "2026-10-19T00:00:00Z",
      deadline: "2026-10-21T00:00:00Z",
    });
    assert.equal(res.verified, false);
    assert.equal(res.suggestedVerdict, "pending");
    assert.equal(res.evidence.configured, false);
  });
});

test("expired token is refreshed", async () => {
  await withEnv(ENV, async () => {
    const calls: string[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push(String(url));
      assert.match(String(init?.body), /grant_type=refresh_token/);
      return new Response(JSON.stringify({ access_token: "new", refresh_token: "r2", expires_at: 9999 }));
    }) as unknown as typeof fetch;
    const tokens = { accessToken: "old", refreshToken: "r1", expiresAt: 100, athleteId: 1, athleteName: null, connectedAt: "" };
    const out = await freshTokens(tokens, fake, 1000);
    assert.equal(out.refreshed, true);
    assert.equal(out.tokens.accessToken, "new");
    assert.equal(out.tokens.refreshToken, "r2");
    const same = await freshTokens({ ...tokens, expiresAt: 5000 }, fake, 1000);
    assert.equal(same.refreshed, false);
    assert.equal(calls.length, 1);
  });
});

function mockStrava(activities: StravaActivity[], tokens: object) {
  const seen: string[] = [];
  const realFetch = globalThis.fetch;
  const fake = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push(url);
    if (url.startsWith("https://redis.test")) {
      const cmd = JSON.parse(String(init?.body)) as string[];
      return new Response(JSON.stringify({ result: cmd[0] === "GET" ? JSON.stringify(tokens) : "OK" }));
    }
    if (url.includes("/athlete/activities")) {
      assert.match(String((init?.headers as Record<string, string>).Authorization), /^Bearer /);
      return new Response(JSON.stringify(activities));
    }
    throw new Error(`unexpected ${url}`);
  }) as unknown as typeof fetch;
  globalThis.fetch = fake;
  return { seen, fake, restore: () => (globalThis.fetch = realFetch) };
}

const live = { accessToken: "a", refreshToken: "r", expiresAt: 4_000_000_000, athleteId: 7, athleteName: "Adi", connectedAt: "" };

test("check reads activities in the promise window and suggests kept", async () => {
  await withEnv(ENV, async () => {
    const m = mockStrava([act(11, "Run", 5.4), act(12, "Run", 2)], live);
    try {
      const res = await checkStravaActivity(
        { activity: "run", minDistanceKm: 5, promiseId: "p1", createdAt: "2026-10-19T00:00:00Z", deadline: "2026-10-25T00:00:00Z" },
        m.fake,
        new Date("2026-10-22T00:00:00Z"),
      );
      assert.equal(res.verified, true);
      assert.equal(res.goalMet, true);
      assert.equal(res.suggestedVerdict, "kept");
      const url = m.seen.find((u) => u.includes("activities"))!;
      assert.match(url, new RegExp(`after=${Date.parse("2026-10-19T00:00:00Z") / 1000}`));
      assert.match(url, new RegExp(`before=${Date.parse("2026-10-22T00:00:00Z") / 1000}`));
    } finally {
      m.restore();
    }
  });
});

test("check suggests broken after the deadline and pending before it", async () => {
  await withEnv(ENV, async () => {
    const m = mockStrava([act(21, "Run", 3)], live);
    try {
      const q = { activity: "run", minDistanceKm: 5, promiseId: "p2", createdAt: "2026-10-19T00:00:00Z", deadline: "2026-10-21T00:00:00Z" };
      const after = await checkStravaActivity(q, m.fake, new Date("2026-10-22T00:00:00Z"));
      assert.equal(after.suggestedVerdict, "broken");
      const before = await checkStravaActivity(q, m.fake, new Date("2026-10-20T00:00:00Z"));
      assert.equal(before.suggestedVerdict, "pending");
    } finally {
      m.restore();
    }
  });
});

test("no stored tokens means not connected", async () => {
  await withEnv(ENV, async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ result: null }))) as unknown as typeof fetch;
    try {
      const res = await checkStravaActivity({ activity: "run", promiseId: "p3", createdAt: "2026-10-19T00:00:00Z", deadline: "2026-10-21T00:00:00Z" });
      assert.equal(res.evidence.connected, false);
      assert.equal(res.suggestedVerdict, "pending");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
