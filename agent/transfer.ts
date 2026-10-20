import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chain } from "@/lib/escrow";
import {
  AGENT_CAP,
  erc20TransferAbi,
  overAgentCap,
  toUnits,
  usdcAddress,
  type Transfer,
} from "@/lib/transfer";

export async function sendFromAgent(transfer: Transfer): Promise<{ hash: Hex; from: string }> {
  const key = process.env.WALLET_PRIVATE_KEY;
  if (!key) throw new Error("The agent wallet is not set up on this server.");
  if (overAgentCap(transfer)) {
    throw new Error(`The agent wallet sends at most ${AGENT_CAP[transfer.token]} ${transfer.token} per transfer.`);
  }

  const account = privateKeyToAccount(key as Hex);
  const reader = createPublicClient({ chain, transport: http() });
  const wallet = createWalletClient({ account, chain, transport: http() });
  const amount = toUnits(transfer.token, transfer.amount);

  let hash: Hex;
  if (transfer.token === "USDC") {
    const balance = await reader.readContract({ address: usdcAddress, abi: erc20TransferAbi, functionName: "balanceOf", args: [account.address] });
    if (balance < amount) throw new Error("The agent wallet does not have enough test USDC.");
    hash = await wallet.writeContract({ address: usdcAddress, abi: erc20TransferAbi, functionName: "transfer", args: [transfer.to, amount] });
  } else {
    const balance = await reader.getBalance({ address: account.address });
    if (balance < amount) throw new Error("The agent wallet does not have enough test ETH.");
    hash = await wallet.sendTransaction({ to: transfer.to, value: amount });
  }

  const receipt = await reader.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`The transfer reverted. Tx ${hash}`);
  return { hash, from: account.address };
}

export function agentAddress(): string | null {
  const key = process.env.WALLET_PRIVATE_KEY;
  return key ? privateKeyToAccount(key as Hex).address : null;
}
