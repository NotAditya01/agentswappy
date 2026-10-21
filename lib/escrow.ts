import { keccak256, parseAbi, parseUnits, toHex, type Address, type Hex } from "viem";
import { baseSepolia } from "viem/chains";

export const chain = baseSepolia;

export const ESCROW_ADDRESS = process.env.NEXT_PUBLIC_ESCROW_ADDRESS as Address | undefined;
export const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS ||
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as Address;

export const FAUCET_URL = "https://faucet.circle.com";

export const escrowAbi = parseAbi([
  "struct PromiseData { address maker; uint64 deadline; uint8 status; address beneficiary; uint128 makerStake; uint128 backedTotal; }",
  "function createPromise(bytes32 id, address beneficiary, uint256 amount, uint64 deadline)",
  "function createPromiseWithPermit(bytes32 id, address beneficiary, uint256 amount, uint64 deadline, uint256 permitDeadline, uint8 v, bytes32 r, bytes32 s)",
  "function settle(bytes32 id, bool kept)",
  "function expire(bytes32 id)",
  "function gracePeriod() view returns (uint64)",
  "error GraceNotOver()",
  "error NotOpen()",
  "function creditBacking(bytes32 id, address backer, uint256 amount, bytes32 x402TxHash)",
  "function paymentCredited(bytes32 txHash) view returns (bool)",
  "error NotEnoughUnattributed()",
  "event Backed(bytes32 indexed id, address indexed backer, uint256 amount, bytes32 x402TxHash)",
  "function getPromise(bytes32 id) view returns (PromiseData)",
  "event PromiseCreated(bytes32 indexed id, address indexed maker, address indexed beneficiary, uint256 amount, uint64 deadline)",
  "event Refunded(bytes32 indexed id, address indexed to, uint256 amount)",
  "event Forfeited(bytes32 indexed id, address indexed beneficiary, uint256 total)",
  "event Settled(bytes32 indexed id, bool kept, uint256 total)",
]);

export const usdcAbi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export const STATUS_OPEN = 1;

export function escrowId(promiseId: string): Hex {
  return keccak256(toHex(promiseId));
}

export function usdcUnits(amount: string): bigint {
  return parseUnits(amount, 6);
}

export function txUrl(hash: string): string {
  return `https://sepolia.basescan.org/tx/${hash}`;
}
