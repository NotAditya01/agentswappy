export type ProofType = "github_commits" | "image" | "strava";

export type Verdict = "kept" | "broken" | "pending";

export type DecidedBy = "agent" | "evidence-rules";

export type PromiseStatus = "open" | "checking" | "resolved";

export type GithubCriteria = {
  owner: string;
  repo: string;
  minCommits: number;
  author?: string;
  since?: string;
};

export type ImageCriteria = {
  claim: string;
};

export type StravaCriteria = {
  activity: string;
  minDistanceKm?: number;
};

export type PromiseCriteria = GithubCriteria | ImageCriteria | StravaCriteria;

export type TraceStep = {
  tool: string;
  args: unknown;
  result: unknown;
  error?: boolean;
};

export type ImageProof = {
  fileName: string;
  mimeType: string;
  storedName: string;
  bytes: number;
  uploadedAt: string;
};

export type ProofCheckResult = {
  provider: "github" | "image" | "strava";
  verified: boolean;
  goalMet: boolean;
  missingUserProof: boolean;
  suggestedVerdict: Verdict;
  summary: string;
  evidence: Record<string, unknown>;
};

export type SettlementOutcome = "refund" | "forfeit";

export type SettlementReceipt = {
  id: string;
  promiseId: string;
  mocked: true;
  network: "base-sepolia";
  asset: "USDC";
  amount: string;
  outcome: SettlementOutcome;
  fromLabel: "mock-escrow";
  to: string;
  toLabel: string;
  txHash: null;
  createdAt: string;
  note: string;
};

export type SettlementIntent = {
  promiseId: string;
  verdict: "kept" | "broken";
  amountUsdc: string;
  makerAddress: string;
  beneficiaryName: string;
  beneficiaryAddress: string;
};

export type StakeBackResult = {
  status: "stub";
  week: 3;
  promiseId: string;
  amountUsdc: string;
  asset: "USDC";
  network: "base-sepolia";
  message: string;
};

export type PromiseRecord = {
  id: string;
  description: string;
  deadline: string;
  proofType: ProofType;
  target: string;
  criteria: PromiseCriteria;
  stakeUsdc: string;
  makerAddress: string;
  beneficiaryName: string;
  beneficiaryAddress: string;
  status: PromiseStatus;
  verdict: Verdict | null;
  explanation: string | null;
  decidedBy: DecidedBy | null;
  trace: TraceStep[];
  settlement: SettlementReceipt | null;
  imageProof: ImageProof | null;
  createdAt: string;
  checkedAt: string | null;
  checkingStartedAt: string | null;
};

export type PromiseUpdate = Partial<Omit<PromiseRecord, "id" | "createdAt">>;

export type PromiseDraft = {
  description: string;
  deadline: string;
  proofType: ProofType;
  stakeUsdc: string;
  makerAddress: string;
  beneficiaryName: string;
  beneficiaryAddress: string;
  github?: {
    owner: string;
    repo: string;
    minCommits: number;
    author?: string;
    since?: string;
  };
  image?: { claim: string };
  strava?: { activity: string; minDistanceKm?: number };
};

export type CreatePromiseInput = {
  description: string;
  deadline: string;
  proofType: ProofType;
  target: string;
  stakeUsdc: string;
  makerAddress: string;
  beneficiaryName: string;
  beneficiaryAddress: string;
  criteria: PromiseCriteria;
};
