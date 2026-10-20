export type FundPath = "batch" | "permit" | "approve";

type Capabilities = Record<string, unknown> | null | undefined;

// EIP-5792: newer wallets report `atomic.status`, older ones `atomicBatch.supported`.
export function supportsAtomicBatch(capabilities: Capabilities): boolean {
  if (!capabilities) return false;
  const atomic = capabilities.atomic as { status?: string } | undefined;
  if (atomic?.status === "supported" || atomic?.status === "ready") return true;
  const legacy = capabilities.atomicBatch as { supported?: boolean } | undefined;
  return legacy?.supported === true;
}

export function chooseFundPath(input: {
  capabilities: Capabilities;
  usdcHasPermit: boolean;
  escrowHasPermit: boolean;
}): FundPath {
  if (supportsAtomicBatch(input.capabilities)) return "batch";
  if (input.usdcHasPermit && input.escrowHasPermit) return "permit";
  return "approve";
}

// A user saying no in the wallet should stop, not fall through to another path.
export function isUserRejection(err: unknown): boolean {
  const code = (err as { code?: number; cause?: { code?: number } })?.code ?? (err as { cause?: { code?: number } })?.cause?.code;
  if (code === 4001) return true;
  const name = (err as { name?: string })?.name;
  return name === "UserRejectedRequestError";
}
