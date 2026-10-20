import { getAddress, parseEventLogs, type Address, type Log } from "viem";
import { usdcAbi } from "./escrow";

// Finds the USDC transfer from a backer into the escrow inside a transaction's logs.
export function findBackingTransfer(logs: Log[], usdc: Address, escrow: Address): { from: Address; value: bigint } | null {
  const transfers = parseEventLogs({ abi: usdcAbi, logs, eventName: "Transfer" }).filter(
    (log) => getAddress(log.address) === getAddress(usdc) && getAddress(log.args.to) === getAddress(escrow),
  );
  if (transfers.length !== 1) return null;
  return { from: getAddress(transfers[0].args.from), value: transfers[0].args.value };
}
