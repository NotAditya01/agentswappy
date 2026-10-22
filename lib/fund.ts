import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Account,
  type Address,
  type Chain,
  type EIP1193Provider,
  type Hex,
  type Transport,
  type WalletClient,
} from "viem";
import { chain, ESCROW_ADDRESS, escrowAbi, escrowId, USDC_ADDRESS, usdcAbi, usdcUnits } from "./escrow";
import { chooseFundPath, isUserRejection } from "./fund-path";
import { escrowHasPermit, signPermit, usdcHasPermit, type Reader } from "./permit";
import { erc20TransferAbi, toUnits, type Transfer } from "./transfer";
import { signPayment, type PaymentRequirements } from "./x402";
import type { PromiseRecord } from "./types";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

function provider(): EIP1193Provider {
  if (typeof window === "undefined" || !window.ethereum) throw new Error("No browser wallet found. Install Coinbase Wallet or MetaMask.");
  return window.ethereum;
}

export function hasWallet(): boolean {
  return typeof window !== "undefined" && Boolean(window.ethereum) && Boolean(ESCROW_ADDRESS);
}

async function onBaseSepolia(wallet: { getChainId: () => Promise<number>; switchChain: (a: { id: number }) => Promise<void> }) {
  if ((await wallet.getChainId()) === chain.id) return;
  await wallet.switchChain({ id: chain.id }).catch(() => undefined);
  if ((await wallet.getChainId()) !== chain.id) throw new Error("Your wallet is on the wrong network. Switch it to Base Sepolia and try again.");
}

export type FundStep = (step: string) => void;

export async function fundPromise(input: {
  promiseId: string;
  maker: Address;
  beneficiary: Address;
  amountUsdc: string;
  deadline: string;
  onStep?: FundStep;
}): Promise<Hex> {
  const escrow = ESCROW_ADDRESS;
  if (!escrow) throw new Error("The escrow is not configured.");
  const wallet = createWalletClient({ account: input.maker, chain, transport: custom(provider()) });
  const reader = createPublicClient({ chain, transport: http() });
  await onBaseSepolia(wallet);

  const amount = usdcUnits(input.amountUsdc);
  const balance = await reader.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: "balanceOf", args: [input.maker] });
  if (balance < amount) throw new Error("Not enough test USDC in this wallet. Get some from the Circle faucet.");

  const id = escrowId(input.promiseId);
  const deadline = BigInt(Math.floor(new Date(input.deadline).getTime() / 1000));
  const allowance = await reader.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: "allowance", args: [input.maker, escrow] });
  const createArgs = [id, input.beneficiary, amount, deadline] as const;

  // Already approved: one plain create.
  if (allowance >= amount) return createOnly(wallet, reader, escrow, createArgs, input.onStep);

  const capabilities = await wallet.getCapabilities({ chainId: chain.id }).catch(() => null);
  const path = chooseFundPath({
    capabilities: capabilities as Record<string, unknown> | null,
    usdcHasPermit: await usdcHasPermit(reader, USDC_ADDRESS, input.maker),
    escrowHasPermit: await escrowHasPermit(reader, escrow),
  });

  if (path === "batch") {
    try {
      input.onStep?.("Approve and lock in one step in your wallet…");
      const { id: callsId } = await wallet.sendCalls({
        forceAtomic: true,
        calls: [
          { to: USDC_ADDRESS, abi: usdcAbi, functionName: "approve", args: [escrow, amount] },
          { to: escrow, abi: escrowAbi, functionName: "createPromise", args: createArgs },
        ],
      });
      input.onStep?.("Waiting for the batch to land…");
      const result = await wallet.waitForCallsStatus({ id: callsId, timeout: 120_000 });
      const hash = result.receipts?.at(-1)?.transactionHash;
      if (result.status !== "success" || !hash) throw new Error("The batched transaction did not go through.");
      return hash;
    } catch (err) {
      if (isUserRejection(err)) throw err;
      // Some wallets report batching but fail on it. Fall through to the slower path.
    }
  }

  if (path === "permit" || path === "batch") {
    try {
      input.onStep?.("Sign the USDC permit in your wallet…");
      const permitDeadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
      const { v, r, s } = await signPermit({ wallet, reader, usdc: USDC_ADDRESS, owner: input.maker, spender: escrow, value: amount, deadline: permitDeadline });
      input.onStep?.("Lock the stake in your wallet…");
      const hash = await wallet.writeContract({
        address: escrow,
        abi: escrowAbi,
        functionName: "createPromiseWithPermit",
        args: [...createArgs, permitDeadline, v, r, s],
      });
      const receipt = await reader.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The escrow transaction reverted.");
      return hash;
    } catch (err) {
      if (isUserRejection(err)) throw err;
    }
  }

  input.onStep?.("Approve USDC in your wallet…");
  const approveTx = await wallet.writeContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: "approve", args: [escrow, amount] });
  await reader.waitForTransactionReceipt({ hash: approveTx });
  for (let i = 0; i < 10; i++) {
    const seen = await reader.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: "allowance", args: [input.maker, escrow] });
    if (seen >= amount) break;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return createOnly(wallet, reader, escrow, createArgs, input.onStep);
}

async function createOnly(
  wallet: WalletClient<Transport, Chain, Account>,
  reader: Reader,
  escrow: Address,
  args: readonly [Hex, Address, bigint, bigint],
  onStep?: FundStep,
): Promise<Hex> {
  onStep?.("Lock the stake in your wallet…");
  const hash = await wallet.writeContract({ address: escrow, abi: escrowAbi, functionName: "createPromise", args });
  const receipt = await reader.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("The escrow transaction reverted.");
  return hash;
}

export async function sendFromWallet(transfer: Transfer, from: Address): Promise<Hex> {
  const wallet = createWalletClient({ account: from, chain, transport: custom(provider()) });
  const reader = createPublicClient({ chain, transport: http() });
  await onBaseSepolia(wallet);

  const amount = toUnits(transfer.token, transfer.amount);
  const hash =
    transfer.token === "USDC"
      ? await wallet.writeContract({ address: USDC_ADDRESS, abi: erc20TransferAbi, functionName: "transfer", args: [transfer.to, amount] })
      : await wallet.sendTransaction({ to: transfer.to, value: amount });
  const receipt = await reader.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`The transfer reverted. Tx ${hash}`);
  return hash;
}

// Sends USDC into the escrow; the server then credits it to the promise.
export async function sendBacking(amountUsdc: string, from: Address): Promise<Hex> {
  const escrow = ESCROW_ADDRESS;
  if (!escrow) throw new Error("The escrow is not configured.");
  const wallet = createWalletClient({ account: from, chain, transport: custom(provider()) });
  const reader = createPublicClient({ chain, transport: http() });
  await onBaseSepolia(wallet);
  const amount = usdcUnits(amountUsdc);
  const balance = await reader.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: "balanceOf", args: [from] });
  if (balance < amount) throw new Error("Not enough test USDC in this wallet. Get some from the Circle faucet.");
  const hash = await wallet.writeContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: "transfer", args: [escrow, amount] });
  const receipt = await reader.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`The transfer reverted. Tx ${hash}`);
  return hash;
}

// x402: ask the back endpoint for its price, sign a USDC authorization (no gas), and pay.
export async function backWithX402(promiseId: string, amountUsdc: string, from: Address, onStep?: FundStep): Promise<PromiseRecord> {
  const url = `/api/promises/${promiseId}/back?amount=${encodeURIComponent(amountUsdc)}`;
  const first = await fetch(url, { method: "POST" });
  const quote = await first.json();
  if (first.status !== 402) throw new Error(quote.error || "The back endpoint did not ask for a payment.");
  const req = quote.accepts?.[0] as PaymentRequirements | undefined;
  if (!req) throw new Error("The back endpoint sent no payment details.");

  const wallet = createWalletClient({ account: from, chain, transport: custom(provider()) });
  const reader = createPublicClient({ chain, transport: http() });
  await onBaseSepolia(wallet);
  const balance = await reader.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: "balanceOf", args: [from] });
  if (balance < BigInt(req.maxAmountRequired)) throw new Error("Not enough test USDC in this wallet. Get some from the Circle faucet.");

  onStep?.("Sign the USDC payment in your wallet…");
  const header = await signPayment(wallet as unknown as Parameters<typeof signPayment>[0], from, req);
  onStep?.("Paying and crediting your backing…");
  const paid = await fetch(url, { method: "POST", headers: { "X-PAYMENT": header } });
  const data = await paid.json();
  if (!paid.ok) throw new Error(data.paymentTx ? `${data.error} Your payment: ${data.paymentTx}` : data.error || "The payment failed.");
  return data as PromiseRecord;
}

// Anyone can expire a promise once the agent missed the grace window; funds go back to the maker and backers.
export async function expireOnchain(escrowIdHex: Hex, from: Address): Promise<Hex> {
  const escrow = ESCROW_ADDRESS;
  if (!escrow) throw new Error("The escrow is not configured.");
  const wallet = createWalletClient({ account: from, chain, transport: custom(provider()) });
  const reader = createPublicClient({ chain, transport: http() });
  await onBaseSepolia(wallet);
  await reader.simulateContract({ account: from, address: escrow, abi: escrowAbi, functionName: "expire", args: [escrowIdHex] });
  const hash = await wallet.writeContract({ address: escrow, abi: escrowAbi, functionName: "expire", args: [escrowIdHex] });
  const receipt = await reader.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`The expire transaction reverted. Tx ${hash}`);
  return hash;
}
