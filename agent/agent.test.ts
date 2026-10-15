import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { judgePromise } from "./agent.ts";
import { MODEL } from "./model.ts";
import type { PromiseRecord, ProofCheckResult } from "../lib/types.ts";

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

function geminiJson(parts: unknown[]) {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("judgePromise", { concurrency: 1 }, () => {
  test("missing GEMINI_API_KEY throws and does not call Gemini", async () => {
    delete process.env.GEMINI_API_KEY;
    globalThis.fetch = async () => {
      throw new Error("fetch should not run");
    };
    try {
      await assert.rejects(() => judgePromise(githubPromise("vercel", "next.js")), /GEMINI_API_KEY/);
    } finally {
      globalThis.fetch = originalFetch;
      if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previousKey;
    }
  });

  test("a Gemini HTTP error is shown and does not become a rule verdict", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    globalThis.fetch = async (input) => {
      const url = String(input);
      assert.match(url, /generativelanguage\.googleapis\.com/);
      assert.match(url, new RegExp(MODEL));
      return new Response(JSON.stringify({ error: { message: "model exploded", status: "INTERNAL" } }), { status: 500 });
    };
    try {
      await assert.rejects(
        () => judgePromise(githubPromise("vercel", "next.js")),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, /Gemini could not check this promise/);
          assert.match(err.message, /Nothing was settled/);
          assert.doesNotMatch(err.message, /proof checker rules/);
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previousKey;
    }
  });

  test("the model must record a verdict", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    globalThis.fetch = async () => geminiJson([{ text: "I looked at it and I am not sure." }]);
    try {
      await assert.rejects(() => judgePromise(githubPromise("vercel", "next.js")), /did not record a verdict/);
    } finally {
      globalThis.fetch = originalFetch;
      if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previousKey;
    }
  });

  test("the model calls GitHub, reads the live result, and its verdict is kept", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const urls: string[] = [];
    const geminiBodies: string[] = [];
    let turn = 0;
    const explanation = "I read the commit list for vercel/next.js and I am marking this broken anyway.";

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      urls.push(url);
      const body = typeof init?.body === "string" ? init.body : "";
      if (!url.includes("generativelanguage.googleapis.com")) return originalFetch(input, init);

      geminiBodies.push(body);
      turn += 1;
      if (turn === 1) {
        return geminiJson([
          {
            thoughtSignature: "sig-test",
            functionCall: { name: "check_github_commits", id: "call-github", args: {} },
          },
        ]);
      }
      return geminiJson([
        {
          functionCall: {
            name: "record_verdict",
            id: "call-verdict",
            args: { verdict: "broken", explanation },
          },
        },
      ]);
    };

    try {
      const judgment = await judgePromise(githubPromise("vercel", "next.js"));
      const githubUrl = urls.find((url) => url.includes("api.github.com/repos/vercel/next.js/commits"));
      assert.ok(githubUrl);
      const parsed = new URL(githubUrl);
      assert.equal(parsed.searchParams.get("since"), "2026-10-01T00:00:00.000Z");
      assert.equal(parsed.searchParams.get("until"), "2026-10-14T00:00:00.000Z");
      assert.match(geminiBodies[1] ?? "", /sig-test/);
      assert.match(geminiBodies[1] ?? "", /call-github/);
      assert.equal(judgment.decidedBy, "agent");
      assert.equal(judgment.steps[0]?.tool, "check_github_commits");
      assert.equal(judgment.steps[1]?.tool, "record_verdict");

      const evidence = judgment.steps[0]?.result as ProofCheckResult;
      assert.equal(evidence.provider, "github");
      assert.equal(evidence.evidence.owner, "vercel");
      assert.equal(evidence.evidence.repo, "next.js");

      if (evidence.verified && evidence.suggestedVerdict !== "broken") {
        assert.equal(judgment.verdict, "broken");
        assert.equal(judgment.explanation, explanation);
      } else if (!evidence.verified) {
        assert.equal(judgment.verdict, "pending");
        assert.match(judgment.explanation, /stays unsettled/);
      } else {
        assert.equal(judgment.verdict, "broken");
        assert.equal(judgment.explanation, explanation);
      }
    } finally {
      globalThis.fetch = originalFetch;
      if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previousKey;
    }
  });

  test("a failed GitHub check cannot be settled just because the model says broken", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    let turn = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (!url.includes("generativelanguage.googleapis.com")) return originalFetch(input, init);
      turn += 1;
      if (turn === 1) {
        return geminiJson([
          { functionCall: { name: "check_github_commits", id: "call-github", args: {} } },
        ]);
      }
      return geminiJson([
        {
          functionCall: {
            name: "record_verdict",
            id: "call-verdict",
            args: {
              verdict: "broken",
              explanation: "I could not see the repository, so I would break the promise.",
            },
          },
        },
      ]);
    };

    try {
      const judgment = await judgePromise(githubPromise("proof-of-promise-no-such-user-9f3a", "missing"));
      const evidence = judgment.steps[0]?.result as ProofCheckResult;
      assert.equal(evidence.verified, false);
      assert.equal(judgment.verdict, "pending");
      assert.match(judgment.explanation, /stays unsettled/);
      assert.equal(judgment.decidedBy, "agent");
    } finally {
      globalThis.fetch = originalFetch;
      if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previousKey;
    }
  });
});
