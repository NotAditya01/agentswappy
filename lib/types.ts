export type ProofType = "github_commits" | "image";

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

export type PromiseCriteria = GithubCriteria | ImageCriteria;

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
  provider: "github" | "image";
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
  mocked: boolean;
  network: "base-sepolia";
  asset: "USDC";
  amount: string;
  outcome: SettlementOutcome;
  fromLabel: "mock-escrow" | "escrow";
  to: string;
  toLabel: string;
  txHash: `0x${string}` | null;
  payouts?: { to: string; amount: string }[];
  createdAt: string;
  note: string;
};

export type OnchainStake = {
  escrowId: `0x${string}`;
  createTx: `0x${string}`;
  maker: string;
};

export type SettlementIntent = {
  promiseId: string;
  onchain: OnchainStake | null;
  verdict: "kept" | "broken";
  amountUsdc: string;
  makerAddress: string;
  beneficiaryName: string;
  beneficiaryAddress: string;
};

// via: how the USDC reached the escrow. Older records have no via.
export type Backing = { backer: string; amountUsdc: string; txHash: string; creditTx: string; at: string; via?: "x402" | "transfer" };

export type ChainState = {
  status: "none" | "open" | "kept" | "broken" | "expired";
  stakeUsdc: string;
  backedUsdc: string;
  expiresAt: string;
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
  onchain?: OnchainStake | null;
  walletStake?: boolean;
  backings?: Backing[];
  chain?: ChainState;
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
  walletStake?: boolean;
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
  walletStake?: boolean;
};
