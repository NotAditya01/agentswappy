import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { judgeGithub, judgePromise } from "./agent.ts";
import type { PromiseRecord } from "../lib/types.ts";

const originalFetch = globalThis.fetch;
const previousKey = process.env.GEMINI_API_KEY;

function githubPromise(owner: string, repo: string): PromiseRecord {
  return {
    id: "p1",
    description: `Land at least one commit on ${owner}/${repo}`,
    deadline: "2026-10-14T00:00:00.000Z",
    proofType: "github_commits",
    target: `At least 1 commit on ${owner}/${repo}`,
    criteria: { owner, repo, minCommits: 1, since: "2026-10-01T00:00:00.000Z" },
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
    imageProof: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    checkedAt: null,
    checkingStartedAt: null,
  };
}

function githubOnly(commits: number, status = 200) {
  const seen: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    seen.push(url);
    if (!url.includes("api.github.com")) throw new Error(`unexpected call to ${url}`);
    if (status !== 200) return new Response("Not Found", { status });
    const list = Array.from({ length: commits }, (_, i) => ({
      sha: `abc${i}def0`,
      html_url: `https://github.com/o/r/commit/${i}`,
      commit: { message: `change ${i}`, author: { date: "2026-10-05T10:00:00Z", name: "dev" } },
    }));
    return new Response(JSON.stringify(list), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return seen;
}

describe("GitHub verdicts need no model", { concurrency: 1 }, () => {
  const after = new Date("2026-10-15T00:00:00.000Z");
  const before = new Date("2026-10-10T00:00:00.000Z");

  test("enough commits is kept, with no Gemini key at all", async () => {
    delete process.env.GEMINI_API_KEY;
    const seen = githubOnly(2);
    try {
      const j = await judgeGithub(githubPromise("vercel", "next.js"), undefined, after);
      assert.equal(j.verdict, "kept");
      assert.equal(j.decidedBy, "evidence-rules");
      assert.match(j.explanation, /^Found 2 commits on vercel\/next\.js between 2026-10-01 00:00 UTC and 2026-10-14 00:00 UTC; needed 1\./);
      assert.ok(seen.every((u) => !u.includes("generativelanguage")));
      assert.deepEqual(j.steps.map((s) => s.tool), ["check_github_commits", "record_verdict"]);
    } finally {
      globalThis.fetch = originalFetch;
      if (previousKey !== undefined) process.env.GEMINI_API_KEY = previousKey;
    }
  });

  test("no commits after the deadline is broken", async () => {
    githubOnly(0);
    try {
      const j = await judgeGithub(githubPromise("vercel", "next.js"), undefined, after);
      assert.equal(j.verdict, "broken");
      assert.match(j.explanation, /Found 0 commits .* needed 1\. The deadline passed/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("no commits before the deadline stays pending", async () => {
    githubOnly(0);
    try {
      const j = await judgeGithub(githubPromise("vercel", "next.js"), undefined, before);
      assert.equal(j.verdict, "pending");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("a GitHub error never settles", async () => {
    githubOnly(0, 404);
    try {
      const j = await judgeGithub(githubPromise("nobody", "missing"), undefined, after);
      assert.equal(j.verdict, "pending");
      assert.match(j.explanation, /GitHub returned 404/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("judgePromise routes GitHub promises past the model", async () => {
    delete process.env.GEMINI_API_KEY;
    githubOnly(1);
    try {
      const j = await judgePromise(githubPromise("vercel", "next.js"));
      assert.equal(j.decidedBy, "evidence-rules");
      assert.equal(j.verdict, "kept");
    } finally {
      globalThis.fetch = originalFetch;
      if (previousKey !== undefined) process.env.GEMINI_API_KEY = previousKey;
    }
  });

  test("photo promises still need the Gemini key", async () => {
    delete process.env.GEMINI_API_KEY;
    const photo = { ...githubPromise("a", "b"), proofType: "image" as const, criteria: { claim: "a run" } };
    try {
      await assert.rejects(() => judgePromise(photo), /GEMINI_API_KEY/);
    } finally {
      if (previousKey !== undefined) process.env.GEMINI_API_KEY = previousKey;
    }
  });
});
