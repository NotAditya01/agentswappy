"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/field";
import { txUrl } from "@/lib/escrow";
import { sendFromWallet } from "@/lib/fund";
import { useWallet } from "@/components/wallet-provider";
import type { Sender, Transfer } from "@/lib/transfer";

type Review = { transfer: Transfer; agentAddress: string | null; agentCap: Record<string, string> };

function short(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function TransferPanel() {
  const { installed, account, connect, refreshBalance } = useWallet();
  const [prompt, setPrompt] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [sender, setSender] = useState<Sender>("agent");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);

  async function read(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setHash(null);
    setReview(null);
    setBusy("Reading your request…");
    try {
      const res = await fetch("/api/transfer/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not read that request.");
      setReview(data);
      setSender(data.agentAddress ? "agent" : "wallet");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(null);
  }

  const overCap =
    review && sender === "agent" && Number(review.transfer.amount) > Number(review.agentCap[review.transfer.token]);

  async function confirm() {
    if (!review) return;
    setError(null);
    try {
      if (sender === "wallet") {
        setBusy("Approve the transfer in your wallet…");
        const from = account ?? (await connect());
        if (!from) throw new Error("Connect your wallet first.");
        setHash(await sendFromWallet(review.transfer, from));
      } else {
        setBusy("Swappy is sending…");
        const res = await fetch("/api/transfer/send", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...review.transfer, confirmed: true }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "The transfer failed.");
        setHash(data.hash);
      }
      await refreshBalance();
      setReview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(null);
  }

  return (
    <section className="flex flex-col gap-4 border px-4 py-5">
      <div>
        <p className="text-sm text-muted-foreground">Send</p>
        <h2 className="text-xl font-semibold tracking-tight">Ask Swappy to send tokens</h2>
        <p className="mt-1 text-sm text-muted-foreground">USDC or ETH on Base Sepolia testnet. You review it before anything is sent.</p>
      </div>
      <form onSubmit={read} className="flex flex-col gap-2 sm:flex-row">
        <input
          className={controlClass}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="send 1 USDC to 0x…"
          disabled={Boolean(busy)}
        />
        <Button type="submit" size="lg" disabled={Boolean(busy) || !prompt.trim()}>
          Review
        </Button>
      </form>

      {review && (
        <div className="flex flex-col gap-3 border px-4 py-4 text-sm">
          <dl className="grid grid-cols-[7rem_1fr] gap-y-1">
            <dt className="text-muted-foreground">Token</dt>
            <dd>{review.transfer.token}</dd>
            <dt className="text-muted-foreground">Amount</dt>
            <dd>{review.transfer.amount}</dd>
            <dt className="text-muted-foreground">To</dt>
            <dd className="break-all font-mono">{review.transfer.to}</dd>
            <dt className="text-muted-foreground">Network</dt>
            <dd>Base Sepolia (testnet)</dd>
            <dt className="text-muted-foreground">From</dt>
            <dd className="flex flex-col gap-1">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={sender === "agent"}
                  disabled={!review.agentAddress}
                  onChange={() => setSender("agent")}
                />
                Swappy&apos;s wallet {review.agentAddress ? `(${short(review.agentAddress)})` : "(not set up)"}
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={sender === "wallet"} disabled={!installed} onChange={() => setSender("wallet")} />
                Your wallet {!installed ? "(no browser wallet found)" : account ? `(${short(account)}, you sign it)` : "(you sign it)"}
              </label>
            </dd>
          </dl>
          {overCap && (
            <p className="text-destructive">
              Swappy&apos;s wallet sends at most {review.agentCap[review.transfer.token]} {review.transfer.token}. Use your wallet instead.
            </p>
          )}
          <div className="flex gap-2">
            <Button onClick={confirm} disabled={Boolean(busy) || Boolean(overCap)}>
              Confirm and send
            </Button>
            <Button variant="outline" onClick={() => setReview(null)} disabled={Boolean(busy)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {busy && <p className="text-sm text-muted-foreground">{busy}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {hash && (
        <p className="text-sm">
          Sent.{" "}
          <a className="break-all underline" href={txUrl(hash)} target="_blank" rel="noreferrer">
            {hash}
          </a>
        </p>
      )}
    </section>
  );
}
