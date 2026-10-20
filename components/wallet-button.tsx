"use client";

import { Button } from "@/components/ui/button";
import { useWallet } from "@/components/wallet-provider";
import { chain } from "@/lib/escrow";

export function WalletButton() {
  const { installed, account, chainId, usdc, connecting, error, connect } = useWallet();

  if (installed === null) return <div className="h-8" />;

  if (!installed) {
    return <p className="text-sm text-muted-foreground">No browser wallet found. Install Coinbase Wallet or MetaMask to connect.</p>;
  }

  if (!account) {
    return (
      <div className="flex flex-col items-start gap-1">
        <Button variant="outline" onClick={connect} disabled={connecting}>
          {connecting ? "Connecting…" : "Connect wallet"}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <a
        className="font-mono underline underline-offset-4"
        href={`https://sepolia.basescan.org/address/${account}`}
        target="_blank"
        rel="noreferrer"
      >
        {account.slice(0, 6)}…{account.slice(-4)}
      </a>
      <span>{usdc === null ? "… USDC" : `${Number(usdc).toLocaleString(undefined, { maximumFractionDigits: 2 })} test USDC`}</span>
      {chainId !== chain.id && (
        <Button variant="outline" size="sm" onClick={connect}>
          Switch to Base Sepolia
        </Button>
      )}
    </div>
  );
}
