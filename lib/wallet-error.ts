import { isUserRejection } from "./fund-path";

// Turns wallet and RPC errors into one plain sentence.
export function walletErrorMessage(err: unknown): string {
  if (isUserRejection(err)) return "You rejected the request in your wallet. Nothing was sent.";
  const raw = err instanceof Error ? err.message : String(err);
  if (/insufficient funds|exceeds balance|transfer amount exceeds/i.test(raw)) {
    return "Not enough funds in this wallet. Get test USDC from faucet.circle.com and a little Base Sepolia ETH for gas.";
  }
  if (/chain mismatch|does not match the target chain|unrecognized chain|switch.*chain|4902/i.test(raw)) {
    return "Your wallet is on the wrong network. Switch it to Base Sepolia and try again.";
  }
  if (/GraceNotOver/.test(raw)) return "The grace period isn't over yet, so this can't be expired.";
  if (/NotOpen/.test(raw)) return "This promise is already settled on-chain.";
  return raw.split("\n")[0].slice(0, 240);
}
