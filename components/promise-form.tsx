"use client";

import { walletErrorMessage } from "@/lib/wallet-error";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, controlClass } from "@/components/field";
import { toLocalInput } from "@/lib/format";
import { FAUCET_URL } from "@/lib/escrow";
import { fundPromise, hasWallet } from "@/lib/fund";
import { useWallet } from "@/components/wallet-provider";
import { MAX_RAW_PHOTO_BYTES, shrinkPhoto } from "@/lib/shrink";
import { isAddress } from "viem";
import type { PromiseDraft, ProofType } from "@/lib/types";
import type { PromisePrefill } from "@/lib/intent";

const SIMULATED_REFUND = "0x1111111111111111111111111111111111111111";
const SIMULATED_PAYOUT = "0x2222222222222222222222222222222222222222";

const PROOF_HELP: Record<ProofType, string> = {
  github_commits: "We look up public commits on the repository you name, from the start date through the deadline.",
  image: "Upload a photo or a workout screenshot from any fitness app. Gemini reads it, including distance and date, and Swappy decides if it shows what you described.",
};

type FormState = {
  description: string;
  deadline: string;
  proofType: ProofType;
  stakeUsdc: string;
  beneficiaryName: string;
  beneficiaryAddress: string;
  repo: string;
  minCommits: string;
  since: string;
  claim: string;
};

function blankForm(): FormState {
  return {
    description: "",
    deadline: toLocalInput(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
    proofType: "github_commits",
    stakeUsdc: "5.00",
    beneficiaryName: "A friend",
    beneficiaryAddress: "",
    repo: "",
    minCommits: "1",
    since: "",
    claim: "",
  };
}

function exampleForm(): FormState {
  const deadline = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const since = new Date(deadline.getTime() - 14 * 24 * 60 * 60 * 1000);
  return {
    ...blankForm(),
    description: "Land at least one commit on vercel/next.js",
    deadline: toLocalInput(deadline),
    proofType: "github_commits",
    stakeUsdc: "5.00",
    beneficiaryName: "A friend",
    repo: "vercel/next.js",
    minCommits: "1",
    since: toLocalInput(since),
  };
}

function parseRepo(input: string): { owner: string; repo: string } | null {
  const value = input
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  const parts = value.split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  return { owner: parts[0], repo: parts[1] };
}

export function PromiseForm({ onCreated, prefill }: { onCreated: () => Promise<void>; prefill?: { value: PromisePrefill; key: number } | null }) {
  const [form, setForm] = useState(blankForm);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exampleNote, setExampleNote] = useState(false);
  const [walletAvailable, setWalletAvailable] = useState(false);
  const { account, connect: connectShared, refreshBalance, error: walletError } = useWallet();
  const [step, setStep] = useState<string | null>(null);

  useEffect(() => setWalletAvailable(hasWallet()), []);

  useEffect(() => {
    if (!prefill) return;
    const p = prefill.value;
    setForm({
      ...blankForm(),
      description: p.description,
      deadline: toLocalInput(new Date(p.deadline)),
      proofType: p.proofType,
      stakeUsdc: p.stakeUsdc,
      beneficiaryName: p.beneficiaryName,
      beneficiaryAddress: p.beneficiaryAddress,
      repo: p.repo,
      minCommits: p.minCommits,
      claim: p.claim,
    });
    setExampleNote(false);
    setError(null);
  }, [prefill]);

  async function connect() {
    setError(null);
    await connectShared();
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setExampleNote(false);
    setForm((current) => ({ ...current, [key]: value }));
  }

  function tryExample() {
    setForm(exampleForm());
    setFile(null);
    setError(null);
    setExampleNote(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const deadline = new Date(form.deadline);
    if (account) {
      if (!isAddress(form.beneficiaryAddress.trim())) {
        setError("Enter the wallet address that gets the stake if you break it.");
        setSaving(false);
        return;
      }
      if (deadline.getTime() <= Date.now()) {
        setError("To lock USDC, the deadline has to be in the future.");
        setSaving(false);
        return;
      }
    }
    const draft: PromiseDraft = {
      description: form.description,
      deadline: deadline.toISOString(),
      proofType: form.proofType,
      stakeUsdc: form.stakeUsdc,
      makerAddress: account ?? SIMULATED_REFUND,
      beneficiaryName: form.beneficiaryName,
      beneficiaryAddress: account ? form.beneficiaryAddress.trim() : SIMULATED_PAYOUT,
      ...(account ? { walletStake: true } : {}),
    };

    if (form.proofType === "github_commits") {
      const repo = parseRepo(form.repo);
      if (!repo) {
        setError("Use a repository like vercel/next.js.");
        setSaving(false);
        return;
      }
      const since = form.since ? new Date(form.since).toISOString() : undefined;
      draft.github = {
        owner: repo.owner,
        repo: repo.repo,
        minCommits: Number(form.minCommits),
        ...(since ? { since } : {}),
      };
    } else {
      draft.image = { claim: form.claim };
    }

    try {
      const res = await fetch("/api/promises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save the promise.");

      if (account) {
        const txHash = await fundPromise({
          promiseId: data.id,
          maker: account,
          beneficiary: data.beneficiaryAddress,
          amountUsdc: data.stakeUsdc,
          deadline: data.deadline,
          onStep: setStep,
        });
        setStep("Confirming the escrow…");
        const staked = await fetch(`/api/promises/${data.id}/stake`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ txHash }),
        });
        const stakedData = await staked.json();
        if (!staked.ok) throw new Error(stakedData.error || "The stake was sent, but the app could not confirm it.");
        await refreshBalance();
      }

      if (form.proofType === "image" && file) {
        const body = new FormData();
        body.append("image", await shrinkPhoto(file));
        const upload = await fetch(`/api/promises/${data.id}/proof`, { method: "POST", body });
        const uploaded = await upload.json();
        if (!upload.ok) throw new Error(uploaded.error || "The promise was saved, but the photo upload failed.");
      }

      setForm(blankForm());
      setFile(null);
      setExampleNote(false);
      await onCreated();
    } catch (err) {
      setError(walletErrorMessage(err));
    }
    setStep(null);
    setSaving(false);
  }

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Step 1</p>
            <h2 className="text-xl font-semibold tracking-tight">Make a promise</h2>
          </div>
          <Button type="button" variant="outline" onClick={tryExample} className="h-11">
            Try an example
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          {exampleNote && (
            <p className="text-sm text-muted-foreground">
              The example only fills this form. It uses public commits on vercel/next.js. Nothing is saved until you make the promise.
            </p>
          )}

          <Field label="What will you do?">
            <textarea
              value={form.description}
              onChange={(event) => set("description", event.target.value)}
              required
              rows={3}
              placeholder="Ship one commit to my repo"
              className={`${controlClass} min-h-24`}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Deadline">
              <Input type="datetime-local" value={form.deadline} onChange={(event) => set("deadline", event.target.value)} required className="h-11 text-base md:text-base" />
            </Field>
            <Field
              label="Stake (USDC)"
              hint={
                account ? (
                  <>
                    Test USDC on Base Sepolia.{" "}
                    <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="underline">
                      Get some from the Circle faucet
                    </a>
                  </>
                ) : (
                  "Simulated. Connect a wallet to lock real test USDC."
                )
              }
            >
              <Input value={form.stakeUsdc} onChange={(event) => set("stakeUsdc", event.target.value)} inputMode="decimal" required className="h-11 text-base md:text-base" />
            </Field>
          </div>

          <Field label="How will you prove it?" hint={PROOF_HELP[form.proofType]}>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["github_commits", "GitHub"],
                  ["image", "Photo"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={form.proofType === value}
                  onClick={() => set("proofType", value)}
                  className={`h-11 border text-sm ${form.proofType === value ? "border-primary bg-primary text-primary-foreground" : "border-input hover:border-primary"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>

          {form.proofType === "github_commits" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Repository" hint="A public GitHub repo, like vercel/next.js.">
                <Input value={form.repo} onChange={(event) => set("repo", event.target.value)} placeholder="vercel/next.js" required className="h-11 text-base md:text-base" />
              </Field>
              <Field label="Commits needed">
                <Input value={form.minCommits} onChange={(event) => set("minCommits", event.target.value)} inputMode="numeric" required className="h-11 text-base md:text-base" />
              </Field>
              <Field label="Start counting" hint="Leave blank to start when you make the promise. The deadline is the end.">
                <Input type="datetime-local" value={form.since} onChange={(event) => set("since", event.target.value)} className="h-11 text-base md:text-base" />
              </Field>
            </div>
          )}

          {form.proofType === "image" && (
            <div className="flex flex-col gap-4">
              <Field label="What should the photo show?">
                <textarea
                  value={form.claim}
                  onChange={(event) => set("claim", event.target.value)}
                  required
                  rows={3}
                  placeholder="A race bib from a 5k"
                  className={`${controlClass} min-h-24`}
                />
              </Field>
              <Field label="Photo" hint="JPEG, PNG, WebP, or GIF. Large photos are shrunk before upload. You can add it later.">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={(event) => {
                    const next = event.target.files?.[0] ?? null;
                    if (next && next.size > MAX_RAW_PHOTO_BYTES) {
                      setError("Image must be 25 MB or smaller.");
                      setFile(null);
                      return;
                    }
                    setError(null);
                    setFile(next);
                  }}
                  className={`${controlClass} file:mr-3 file:text-sm`}
                />
              </Field>
            </div>
          )}

          <Field label="Who gets the stake if you break it?">
            <Input value={form.beneficiaryName} onChange={(event) => set("beneficiaryName", event.target.value)} placeholder="A friend" required className="h-11 text-base md:text-base" />
          </Field>

          {account && (
            <Field label="Their wallet address" hint="If you keep it, the stake comes back to your wallet.">
              <Input value={form.beneficiaryAddress} onChange={(event) => set("beneficiaryAddress", event.target.value)} placeholder="0x…" required className="h-11 font-mono text-base md:text-base" />
            </Field>
          )}

          {walletAvailable && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {account ? (
                <span className="font-mono break-all">Wallet {account}</span>
              ) : (
                <Button type="button" variant="outline" onClick={connect} className="h-11">
                  Connect wallet
                </Button>
              )}
              {!account && walletError && (
                <span className="text-destructive">{walletError}</span>
              )}
            </div>
          )}

          {step && (
            <p aria-live="polite" className="text-sm">
              {step}
            </p>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" disabled={saving} className="h-11 w-full sm:w-fit">
            {saving ? "Saving…" : account ? "Make the promise and lock USDC" : "Make the promise"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
