import { createPublicClient, createWalletClient, custom, http, type Address, type EIP1193Provider, type Hex } from "viem";
import { chain, ESCROW_ADDRESS, escrowAbi, escrowId, USDC_ADDRESS, usdcAbi, usdcUnits } from "./escrow";

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

export async function connectWallet(): Promise<Address> {
  const wallet = createWalletClient({ chain, transport: custom(provider()) });
  const [address] = await wallet.requestAddresses();
  if (!address) throw new Error("The wallet did not share an address.");
  return address;
}

export async function fundPromise(input: {
  promiseId: string;
  maker: Address;
  beneficiary: Address;
  amountUsdc: string;
  deadline: string;
  onStep?: (step: string) => void;
}): Promise<Hex> {
  if (!ESCROW_ADDRESS) throw new Error("The escrow is not configured.");
  const wallet = createWalletClient({ account: input.maker, chain, transport: custom(provider()) });
  const reader = createPublicClient({ chain, transport: http() });
  if ((await wallet.getChainId()) !== chain.id) await wallet.switchChain({ id: chain.id });

  const amount = usdcUnits(input.amountUsdc);
  const balance = await reader.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: "balanceOf", args: [input.maker] });
  if (balance < amount) throw new Error("Not enough test USDC in this wallet. Get some from the Circle faucet.");

  const allowance = await reader.readContract({
    address: USDC_ADDRESS,
    abi: usdcAbi,
    functionName: "allowance",
    args: [input.maker, ESCROW_ADDRESS],
  });
  if (allowance < amount) {
    input.onStep?.("Approve USDC in your wallet…");
    const approveTx = await wallet.writeContract({
      address: USDC_ADDRESS,
      abi: usdcAbi,
      functionName: "approve",
      args: [ESCROW_ADDRESS, amount],
    });
    await reader.waitForTransactionReceipt({ hash: approveTx });
  }

  input.onStep?.("Lock the stake in your wallet…");
  const deadline = BigInt(Math.floor(new Date(input.deadline).getTime() / 1000));
  const hash = await wallet.writeContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    functionName: "createPromise",
    args: [escrowId(input.promiseId), input.beneficiary, amount, deadline],
  });
  const receipt = await reader.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("The escrow transaction reverted.");
  return hash;
}
