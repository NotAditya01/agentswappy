import { createPublicClient, http, parseAbi, parseSignature, toFunctionSelector, type Account, type Address, type Chain, type Hex, type Transport, type WalletClient } from "viem";

import { chain } from "./escrow";

export function makeReader() {
  return createPublicClient({ chain, transport: http() });
}
export type Reader = ReturnType<typeof makeReader>;

export const permitAbi = parseAbi([
  "function name() view returns (string)",
  "function version() view returns (string)",
  "function nonces(address owner) view returns (uint256)",
]);

const PERMIT_SELECTOR = toFunctionSelector(
  "createPromiseWithPermit(bytes32,address,uint256,uint64,uint256,uint8,bytes32,bytes32)",
).slice(2);

export async function escrowHasPermit(reader: Reader, escrow: Address): Promise<boolean> {
  const code = await reader.getCode({ address: escrow }).catch(() => undefined);
  return Boolean(code && code.includes(PERMIT_SELECTOR));
}

export async function usdcHasPermit(reader: Reader, usdc: Address, owner: Address): Promise<boolean> {
  try {
    await reader.readContract({ address: usdc, abi: permitAbi, functionName: "nonces", args: [owner] });
    return true;
  } catch {
    return false;
  }
}

export async function signPermit(input: {
  wallet: WalletClient<Transport, Chain, Account>;
  reader: Reader;
  usdc: Address;
  owner: Address;
  spender: Address;
  value: bigint;
  deadline: bigint;
}): Promise<{ v: number; r: Hex; s: Hex }> {
  const { reader, usdc, owner } = input;
  const [name, version, nonce] = await Promise.all([
    reader.readContract({ address: usdc, abi: permitAbi, functionName: "name" }),
    reader.readContract({ address: usdc, abi: permitAbi, functionName: "version" }),
    reader.readContract({ address: usdc, abi: permitAbi, functionName: "nonces", args: [owner] }),
  ]);
  const signature = await input.wallet.signTypedData({
    account: input.wallet.account,
    domain: { name, version, chainId: input.wallet.chain.id, verifyingContract: usdc },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    message: { owner, spender: input.spender, value: input.value, nonce, deadline: input.deadline },
  });
  const { v, r, s, yParity } = parseSignature(signature);
  return { v: Number(v ?? BigInt(yParity + 27)), r, s };
}
