"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/components/wallet-provider";
import { chain } from "@/lib/escrow";

export function WalletButton() {
  const { installed, account, chainId, usdc, connecting, error, connect } = useWallet();
  const [help, setHelp] = useState(false);

  if (installed === null) return <div className="h-8 w-28" />;

  if (!installed) {
    return (
      <div className="relative">
        <Button variant="outline" onClick={() => setHelp((v) => !v)} aria-expanded={help} className="h-8">
          Connect wallet
        </Button>
        {help && (
          <div role="dialog" className="absolute right-0 z-10 mt-2 w-64 rounded-md border bg-popover p-3 text-sm text-muted-foreground">
            No browser wallet found. Install{" "}
            <a className="text-foreground underline underline-offset-4" href="https://metamask.io/download/" target="_blank" rel="noreferrer">MetaMask</a> or{" "}
            <a className="text-foreground underline underline-offset-4" href="https://www.coinbase.com/wallet/downloads" target="_blank" rel="noreferrer">Coinbase Wallet</a>, then reload.
          </div>
        )}
      </div>
    );
  }

  if (!account) {
    return (
      <div className="flex items-center gap-3">
        {error && <p className="hidden text-sm text-destructive sm:block">{error}</p>}
        <Button variant="outline" onClick={connect} disabled={connecting} className="h-8">
          {connecting ? "Connecting…" : "Connect wallet"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      {chainId !== chain.id ? (
        <Button variant="outline" onClick={connect} className="h-8">Switch to Base Sepolia</Button>
      ) : (
        <span className="hidden font-mono text-muted-foreground sm:inline">{usdc === null ? "…" : `${Number(usdc).toFixed(2)} USDC`}</span>
      )}
      <a
        className="flex h-8 items-center rounded-md border px-3 font-mono text-xs transition-colors duration-150 hover:bg-white/[0.05]"
        href={`https://sepolia.basescan.org/address/${account}`}
        target="_blank"
        rel="noreferrer"
      >
        {account.slice(0, 6)}…{account.slice(-4)}
      </a>
    </div>
  );
}
