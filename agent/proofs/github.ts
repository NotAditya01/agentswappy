import { verdictFromCheck } from "../../lib/verdict";
import type { GithubCriteria, ProofCheckResult } from "../../lib/types";

type GithubCommit = {
  sha: string;
  message: string;
  date: string;
  author: string;
  url: string;
};

export function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

function mapCommit(raw: unknown): GithubCommit {
  const commit = raw as {
    sha?: string;
    html_url?: string;
    author?: { login?: string };
    commit?: { message?: string; author?: { date?: string; name?: string } };
  };
  return {
    sha: String(commit.sha ?? "").slice(0, 7),
    message: String(commit.commit?.message ?? "").split("\n")[0].slice(0, 140),
    date: String(commit.commit?.author?.date ?? ""),
    author: String(commit.author?.login ?? commit.commit?.author?.name ?? "unknown"),
    url: String(commit.html_url ?? ""),
  };
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "swappy",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

export async function checkGithubCommits(input: {
  criteria: GithubCriteria;
  deadline: string;
  createdAt: string;
  now?: Date;
}): Promise<ProofCheckResult> {
  const now = input.now ?? new Date();
  const since = input.criteria.since ?? input.createdAt;
  const until = input.deadline;
  const base = {
    provider: "github" as const,
    goalMet: false,
    missingUserProof: false,
  };

  if (new Date(since).getTime() >= new Date(until).getTime()) {
    const suggestedVerdict = verdictFromCheck({
      deadline: input.deadline,
      verified: true,
      goalMet: false,
      missingUserProof: false,
      now,
    });
    return {
      ...base,
      verified: true,
      suggestedVerdict,
      summary: `The commit window is empty, so 0 of ${input.criteria.minCommits} required commits were found.`,
      evidence: { owner: input.criteria.owner, repo: input.criteria.repo, since, until, commitCount: 0 },
    };
  }

  const owner = encodeURIComponent(input.criteria.owner);
  const repo = encodeURIComponent(input.criteria.repo);
  const first = new URL(`https://api.github.com/repos/${owner}/${repo}/commits`);
  first.searchParams.set("since", since);
  first.searchParams.set("until", until);
  first.searchParams.set("per_page", "100");
  if (input.criteria.author) first.searchParams.set("author", input.criteria.author);

  const commits: GithubCommit[] = [];
  let url: string | null = first.toString();
  let pages = 0;
  let truncated = false;

  try {
    while (url && pages < 3) {
      const response = await fetch(url, { headers: githubHeaders(), signal: AbortSignal.timeout(15_000) });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 240);
        return {
          ...base,
          verified: false,
          suggestedVerdict: "pending",
          summary: `GitHub returned ${response.status}, so this stake is not settled. ${detail}`,
          evidence: { status: response.status, owner: input.criteria.owner, repo: input.criteria.repo },
        };
      }
      const data = (await response.json()) as unknown;
      if (!Array.isArray(data)) {
        return {
          ...base,
          verified: false,
          suggestedVerdict: "pending",
          summary: "GitHub returned an unexpected payload, so this stake is not settled.",
          evidence: { owner: input.criteria.owner, repo: input.criteria.repo },
        };
      }
      commits.push(...data.map(mapCommit));
      pages += 1;
      url = nextLink(response.headers.get("link"));
      if (!url) break;
      if (pages >= 3) truncated = true;
    }
  } catch (err) {
    return {
      ...base,
      verified: false,
      suggestedVerdict: "pending",
      summary: `The GitHub check failed (${err instanceof Error ? err.message : String(err)}), so this stake is not settled.`,
      evidence: { owner: input.criteria.owner, repo: input.criteria.repo },
    };
  }

  if (truncated && commits.length < input.criteria.minCommits) {
    return {
      ...base,
      verified: false,
      suggestedVerdict: "pending",
      summary: `Found at least ${commits.length} commits and more pages remain, which is still under ${input.criteria.minCommits}. The stake stays unsettled until the count is complete.`,
      evidence: {
        owner: input.criteria.owner,
        repo: input.criteria.repo,
        since,
        until,
        commitCount: commits.length,
        truncated: true,
        commits: commits.slice(0, 8),
      },
    };
  }

  const goalMet = commits.length >= input.criteria.minCommits;
  const suggestedVerdict = verdictFromCheck({
    deadline: input.deadline,
    verified: true,
    goalMet,
    missingUserProof: false,
    now,
  });
  const author = input.criteria.author ? ` by @${input.criteria.author}` : "";
  const countLabel = truncated ? `at least ${commits.length}` : String(commits.length);
  const summary = goalMet
    ? `Found ${countLabel} commit${commits.length === 1 && !truncated ? "" : "s"}${author} on ${input.criteria.owner}/${input.criteria.repo}. The target is ${input.criteria.minCommits}.`
    : `Found ${countLabel} of ${input.criteria.minCommits} required commits${author} on ${input.criteria.owner}/${input.criteria.repo}.`;

  return {
    provider: "github",
    verified: true,
    goalMet,
    missingUserProof: false,
    suggestedVerdict,
    summary,
    evidence: {
      owner: input.criteria.owner,
      repo: input.criteria.repo,
      author: input.criteria.author ?? null,
      since,
      until,
      minCommits: input.criteria.minCommits,
      commitCount: commits.length,
      truncated,
      commits: commits.slice(0, 8),
    },
  };
}
