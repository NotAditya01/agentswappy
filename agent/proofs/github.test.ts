import assert from "node:assert/strict";
import test from "node:test";
import { checkGithubCommits } from "./github.ts";

const originalFetch = globalThis.fetch;

test("GitHub check calls the live API for the given repo and dates", async () => {
  const urls: string[] = [];
  globalThis.fetch = async (input, init) => {
    urls.push(String(input));
    return originalFetch(input, init);
  };

  try {
    const since = "2026-10-01T00:00:00.000Z";
    const until = "2026-10-14T00:00:00.000Z";
    const result = await checkGithubCommits({
      criteria: { owner: "vercel", repo: "next.js", minCommits: 1, since },
      deadline: until,
      createdAt: since,
    });

    assert.equal(urls.length > 0, true);
    const url = new URL(urls[0]);
    assert.equal(url.origin + url.pathname, "https://api.github.com/repos/vercel/next.js/commits");
    assert.equal(url.searchParams.get("since"), since);
    assert.equal(url.searchParams.get("until"), until);
    assert.equal(result.provider, "github");
    assert.equal(result.evidence.owner, "vercel");
    assert.equal(result.evidence.repo, "next.js");

    if (!result.verified) {
      assert.equal(result.suggestedVerdict, "pending");
      return;
    }

    assert.equal(typeof result.evidence.commitCount, "number");
    assert.ok((result.evidence.commitCount as number) > 0);
    assert.equal(result.goalMet, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an unknown GitHub repo stays unverified", async () => {
  const result = await checkGithubCommits({
    criteria: { owner: "proof-of-promise-no-such-user-9f3a", repo: "missing", minCommits: 1 },
    deadline: "2026-10-14T00:00:00.000Z",
    createdAt: "2026-10-01T00:00:00.000Z",
  });

  assert.equal(result.verified, false);
  assert.equal(result.suggestedVerdict, "pending");
  assert.match(result.summary, /GitHub returned|failed/i);
});
