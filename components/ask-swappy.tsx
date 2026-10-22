"use client";

import { walletErrorMessage } from "@/lib/wallet-error";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/field";
import { useWallet } from "@/components/wallet-provider";
import { txUrl } from "@/lib/escrow";
import { formatUsdc } from "@/lib/format";
import { sendBacking, sendFromWallet } from "@/lib/fund";
import type { Intent, PromisePrefill } from "@/lib/intent";
import type { Sender } from "@/lib/transfer";

const EXAMPLES = [
  "I promise to push 3 commits to owner/repo by Friday, stake 1 USDC, else pay 0x…",
  "back <promise title> with 2 USDC",
  "send 1 USDC to 0x…",
];

type Reply = { intent: Intent; agentAddress: string | null; agentCap: Record<string, string> };

function short(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </>
  );
}

export function AskSwappy({ onPrefill, onChanged }: { onPrefill: (prefill: PromisePrefill) => void; onChanged: () => Promise<void> }) {
  const { installed, account, connect, refreshBalance } = useWallet();
  const [prompt, setPrompt] = useState("");
  const [reply, setReply] = useState<Reply | null>(null);
  const [sender, setSender] = useState<Sender>("agent");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ text: string; hash?: string } | null>(null);

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setDone(null);
    setReply(null);
    setBusy("Swappy is reading that…");
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not read that.");
      setReply(data);
      setSender(data.agentAddress ? "agent" : "wallet");
    } catch (err) {
      setError(walletErrorMessage(err));
    }
    setBusy(null);
  }

  async function walletAccount() {
    const from = account ?? (await connect());
    if (!from) throw new Error("Connect your wallet first.");
    return from;
  }

  async function confirm() {
    if (!reply) return;
    const { intent } = reply;
    setError(null);
    try {
      if (intent.kind === "create_promise") {
        onPrefill(intent.prefill);
        setDone({ text: "The form below is filled in. Check it, then make the promise." });
      } else if (intent.kind === "back_promise") {
        const from = await walletAccount();
        setBusy("Send the USDC to the escrow in your wallet…");
        const hash = await sendBacking(intent.amountUsdc, from);
        setBusy("Swappy is crediting your backing…");
        const res = await fetch(`/api/promises/${intent.promise.id}/back`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ txHash: hash }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(`${data.error || "The backing was sent but not credited."} Your transfer: ${hash}`);
        setDone({ text: `Backed with ${formatUsdc(intent.amountUsdc)} USDC.`, hash: data.backings?.at(-1)?.creditTx ?? hash });
        await refreshBalance();
        await onChanged();
      } else if (intent.kind === "send") {
        let hash: string;
        if (sender === "wallet") {
          const from = await walletAccount();
          setBusy("Approve the transfer in your wallet…");
          hash = await sendFromWallet(intent.transfer, from);
        } else {
          setBusy("Swappy is sending…");
          const res = await fetch("/api/transfer/send", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...intent.transfer, confirmed: true }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "The transfer failed.");
          hash = data.hash;
        }
        setDone({ text: "Sent.", hash });
        await refreshBalance();
      }
      setReply(null);
    } catch (err) {
      setError(walletErrorMessage(err));
    }
    setBusy(null);
  }

  const intent = reply?.intent;
  const overCap =
    intent?.kind === "send" && sender === "agent" && Number(intent.transfer.amount) > Number(reply?.agentCap[intent.transfer.token]);

  return (
    <section className="flex flex-col gap-3 border px-4 py-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Ask Swappy</h2>
        <p className="mt-1 text-sm text-muted-foreground">Prefer typing? Tell Swappy what you want in plain words. Nothing happens until you confirm.</p>
      </div>
      <form onSubmit={ask} className="flex flex-col gap-2 sm:flex-row">
        <input
          className={controlClass}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Tell Swappy what to do"
          disabled={Boolean(busy)}
        />
        <Button type="submit" size="lg" disabled={Boolean(busy) || !prompt.trim()}>
          Ask
        </Button>
      </form>
      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            className="border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setPrompt(example)}
          >
            {example}
          </button>
        ))}
      </div>

      {intent?.kind === "clarify" && <p className="text-sm">{intent.question}</p>}

      {intent && intent.kind !== "clarify" && (
        <div className="flex flex-col gap-3 border px-4 py-4 text-sm">
          <dl className="grid grid-cols-[7rem_1fr] gap-y-1">
            {intent.kind === "create_promise" && (
              <>
                <Row label="Promise">{intent.prefill.description}</Row>
                <Row label="Deadline">{new Date(intent.prefill.deadline).toLocaleString()}</Row>
                <Row label="Proof">{intent.prefill.repo ? `${intent.prefill.minCommits}+ commits on ${intent.prefill.repo}` : `Photo: ${intent.prefill.claim}`}</Row>
                <Row label="Stake">{formatUsdc(intent.prefill.stakeUsdc)} USDC</Row>
                <Row label="If broken, pay">
                  {intent.prefill.beneficiaryAddress ? <span className="font-mono">{intent.prefill.beneficiaryAddress}</span> : "Not set yet, add it in the form"}
                </Row>
              </>
            )}
            {intent.kind === "back_promise" && (
              <>
                <Row label="Back">{intent.promise.description}</Row>
                <Row label="Amount">{formatUsdc(intent.amountUsdc)} USDC</Row>
                <Row label="From">{account ? `Your wallet (${short(account)})` : "Your wallet (connect on confirm)"}</Row>
                <Row label="Goes to">The promise escrow. Refunded to you if it is kept, paid to the friend if broken.</Row>
                <Row label="Network">Base Sepolia (testnet)</Row>
              </>
            )}
            {intent.kind === "send" && (
              <>
                <Row label="Token">{intent.transfer.token}</Row>
                <Row label="Amount">{intent.transfer.amount}</Row>
                <Row label="To"><span className="font-mono">{intent.transfer.to}</span></Row>
                <Row label="Network">Base Sepolia (testnet)</Row>
                <Row label="From">
                  <span className="flex flex-col gap-1">
                    <label className="flex items-center gap-2">
                      <input type="radio" checked={sender === "agent"} disabled={!reply?.agentAddress} onChange={() => setSender("agent")} />
                      Swappy&apos;s wallet {reply?.agentAddress ? `(${short(reply.agentAddress)})` : "(not set up)"}
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="radio" checked={sender === "wallet"} disabled={installed !== true} onChange={() => setSender("wallet")} />
                      Your wallet {installed !== true ? "(no browser wallet found)" : account ? `(${short(account)}, you sign it)` : "(you sign it)"}
                    </label>
                  </span>
                </Row>
              </>
            )}
          </dl>
          {overCap && intent.kind === "send" && (
            <p className="text-destructive">
              Swappy&apos;s wallet sends at most {reply?.agentCap[intent.transfer.token]} {intent.transfer.token}. Use your wallet instead.
            </p>
          )}
          <div className="flex gap-2">
            <Button onClick={confirm} disabled={Boolean(busy) || Boolean(overCap)}>
              {intent.kind === "create_promise" ? "Confirm and fill the form" : "Confirm"}
            </Button>
            <Button variant="outline" onClick={() => setReply(null)} disabled={Boolean(busy)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {busy && <p className="text-sm text-muted-foreground">{busy}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {done && (
        <p className="text-sm">
          {done.text}{" "}
          {done.hash && (
            <a className="break-all underline" href={txUrl(done.hash)} target="_blank" rel="noreferrer">
              {done.hash}
            </a>
          )}
        </p>
      )}
    </section>
  );
}
