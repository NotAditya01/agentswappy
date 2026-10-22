"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/components/wallet-provider";
import { chain } from "@/lib/escrow";

export function WalletButton() {
  const { installed, account, chainId, usdc, connecting, error, connect } = useWallet();
  const [help, setHelp] = useState(false);

  if (installed === null) return <div className="h-9" />;

  if (!installed) {
    return (
      <div className="relative">
        <Button variant="outline" onClick={() => setHelp((v) => !v)} aria-expanded={help}>
          Connect wallet
        </Button>
        {help && (
          <div role="dialog" className="absolute right-0 z-10 mt-2 w-64 border bg-card p-3 text-sm shadow-lg">
            <p>You need a browser wallet to lock test USDC.</p>
            <p className="mt-2">
              Install{" "}
              <a className="underline" href="https://metamask.io/download/" target="_blank" rel="noreferrer">MetaMask</a> or{" "}
              <a className="underline" href="https://www.coinbase.com/wallet/downloads" target="_blank" rel="noreferrer">Coinbase Wallet</a>, then reload this page.
            </p>
          </div>
        )}
      </div>
    );
  }

  if (!account) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button variant="outline" onClick={connect} disabled={connecting}>
          {connecting ? "Connecting…" : "Connect wallet"}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="text-muted-foreground">{usdc === null ? "…" : `${Number(usdc).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`}</span>
      <a
        className="border px-3 py-1.5 font-mono hover:border-primary"
        href={`https://sepolia.basescan.org/address/${account}`}
        target="_blank"
        rel="noreferrer"
      >
        {account.slice(0, 4)}…{account.slice(-4)}
      </a>
      {chainId !== chain.id && (
        <Button variant="outline" size="sm" onClick={connect}>
          Switch to Base Sepolia
        </Button>
      )}
    </div>
  );
}
