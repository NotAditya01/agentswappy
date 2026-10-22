"use client";

import { walletErrorMessage } from "@/lib/wallet-error";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
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

const PAGES = ["The promise", "The proof", "The stakes"];
const PAGE_OF: Record<keyof FormState, number> = {
  description: 0, deadline: 0, proofType: 1, repo: 1, minCommits: 1, since: 1, claim: 1,
  stakeUsdc: 2, beneficiaryName: 2, beneficiaryAddress: 2,
};

type Problems = Partial<Record<keyof FormState, string>>;

function problemsOf(form: FormState, walletStake: boolean): Problems {
  const out: Problems = {};
  if (form.description.trim().length < 5) out.description = "Write a few words about what you will do.";
  const stake = Number(form.stakeUsdc);
  if (!Number.isFinite(stake) || stake <= 0) out.stakeUsdc = "Enter an amount above 0, like 1.00.";
  const deadline = new Date(form.deadline).getTime();
  if (Number.isNaN(deadline)) out.deadline = "Pick a date and time.";
  else if (walletStake && deadline <= Date.now()) out.deadline = "To lock USDC, pick a time in the future.";
  if (form.proofType === "github_commits") {
    if (!parseRepo(form.repo)) out.repo = "Use owner/repo, like vercel/next.js.";
    const n = Number(form.minCommits);
    if (!Number.isInteger(n) || n < 1) out.minCommits = "Use a whole number, 1 or more.";
  } else if (form.claim.trim().length < 3) {
    out.claim = "Describe what the photo should show.";
  }
  if (!form.beneficiaryName.trim()) out.beneficiaryName = "Give them a name, like Sam.";
  if (walletStake && !isAddress(form.beneficiaryAddress.trim())) out.beneficiaryAddress = "Paste their wallet address, it starts with 0x.";
  return out;
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
  const [touched, setTouched] = useState<Partial<Record<keyof FormState, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [page, setPage] = useState(0);
  const problems = problemsOf(form, Boolean(account));
  const show = (key: keyof FormState) => (submitted || touched[key] ? problems[key] : undefined);
  const blur = (key: keyof FormState) => () => setTouched((t) => ({ ...t, [key]: true }));
  const firstBad = (Object.keys(problems) as (keyof FormState)[]).map((k) => PAGE_OF[k]).sort()[0];

  function next() {
    const bad = (Object.keys(problems) as (keyof FormState)[]).filter((k) => PAGE_OF[k] === page);
    if (bad.length) {
      setTouched((t) => ({ ...t, ...Object.fromEntries(bad.map((k) => [k, true])) }));
      return;
    }
    setPage((n) => n + 1);
  }

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
    setPage(0);
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
    setPage(0);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setError(null);
    if (Object.keys(problems).length > 0) {
      setError("Fix the highlighted fields first.");
      if (firstBad !== undefined) setPage(firstBad);
      return;
    }
    setSaving(true);

    const deadline = new Date(form.deadline);
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
      setTouched({});
      setPage(0);
      setSubmitted(false);
      await onCreated();
    } catch (err) {
      setError(walletErrorMessage(err));
    }
    setStep(null);
    setSaving(false);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3 pr-10">
        <div>
          <h2 className="font-display text-2xl font-bold">Make a promise</h2>
          <p className="mt-1 text-sm text-muted-foreground">Step {page + 1} of 3 · {PAGES[page]}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={tryExample}>
          Try an example
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-2" aria-hidden>
        {PAGES.map((name, i) => (
          <span key={name} className={`h-2 rounded-full transition-colors ${i <= page ? "bg-primary" : "bg-muted"}`} />
        ))}
      </div>
        <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
          {exampleNote && (
            <p className="text-sm text-muted-foreground">
              The example only fills this form. It uses public commits on vercel/next.js. Nothing is saved until you make the promise.
            </p>
          )}

          {page === 0 && (
          <Field label="What will you do?" error={show("description")}>
            <textarea
              value={form.description}
              onChange={(event) => set("description", event.target.value)}
              onBlur={blur("description")}
              aria-invalid={Boolean(show("description"))}
              required
              rows={2}
              placeholder="Run 5k three times this week"
              className={`${controlClass} min-h-16`}
            />
          </Field>
          )}

          {page === 0 && (
          <>
          <div className="grid gap-3">
            <Field label="Deadline" error={show("deadline")}>
              <Input type="datetime-local" value={form.deadline} onChange={(event) => set("deadline", event.target.value)} onBlur={blur("deadline")} aria-invalid={Boolean(show("deadline"))} required className="h-11 text-base md:text-base" />
            </Field>
          </div>
          </>
          )}

          {page === 1 && (
          <>
          <Field label="How will you prove it?" hint={PROOF_HELP[form.proofType]}>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["github_commits", "GitHub commits"],
                  ["image", "Photo or screenshot"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={form.proofType === value}
                  onClick={() => set("proofType", value)}
                  className={`h-14 rounded-2xl border-2 font-bold transition-colors ${form.proofType === value ? "border-primary bg-primary/15 text-primary" : "border-input hover:border-primary/60"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>

          {form.proofType === "github_commits" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Repository" hint="A public GitHub repo, like vercel/next.js." error={show("repo")}>
                <Input value={form.repo} onChange={(event) => set("repo", event.target.value)} onBlur={blur("repo")} aria-invalid={Boolean(show("repo"))} placeholder="vercel/next.js" required className="h-11 text-base md:text-base" />
              </Field>
              <Field label="Commits needed" error={show("minCommits")}>
                <Input value={form.minCommits} onChange={(event) => set("minCommits", event.target.value)} onBlur={blur("minCommits")} aria-invalid={Boolean(show("minCommits"))} inputMode="numeric" required className="h-11 text-base md:text-base" />
              </Field>
              <Field label="Start counting" hint="Leave blank to start when you make the promise. The deadline is the end.">
                <Input type="datetime-local" value={form.since} onChange={(event) => set("since", event.target.value)} className="h-11 text-base md:text-base" />
              </Field>
            </div>
          )}

          {form.proofType === "image" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="What should the photo show?" hint="Be specific, like a 5k run on a fitness app screenshot." error={show("claim")}>
                <textarea
                  value={form.claim}
                  onChange={(event) => set("claim", event.target.value)}
                  onBlur={blur("claim")}
                  aria-invalid={Boolean(show("claim"))}
                  required
                  rows={2}
                  placeholder="A race bib from a 5k"
                  className={`${controlClass} min-h-16`}
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

          </>
          )}

          {page === 2 && (
          <>
          <Field
              label="How much to put on it (USDC)"
              error={show("stakeUsdc")}
              hint={
                account ? (
                  <>
                    Locks real test USDC on Base Sepolia from your wallet.{" "}
                    <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="underline">
                      Get some from the Circle faucet
                    </a>
                  </>
                ) : (
                  "Connect a wallet to lock test USDC. Without one, the payout is only simulated."
                )
              }
            >
              <Input value={form.stakeUsdc} onChange={(event) => set("stakeUsdc", event.target.value)} onBlur={blur("stakeUsdc")} aria-invalid={Boolean(show("stakeUsdc"))} inputMode="decimal" required className="h-11 text-base md:text-base" />
            </Field>
          <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Who gets the money if you miss it?" hint="A friend, a rival, a cause. Picking someone you'd hate to pay works best." error={show("beneficiaryName")}>
            <Input value={form.beneficiaryName} onChange={(event) => set("beneficiaryName", event.target.value)} onBlur={blur("beneficiaryName")} aria-invalid={Boolean(show("beneficiaryName"))} placeholder="A friend" required className="h-11 text-base md:text-base" />
          </Field>

          {account && (
            <Field label="Their wallet address" hint="If you keep the promise, the money comes back to your wallet." error={show("beneficiaryAddress")}>
              <Input value={form.beneficiaryAddress} onChange={(event) => set("beneficiaryAddress", event.target.value)} onBlur={blur("beneficiaryAddress")} aria-invalid={Boolean(show("beneficiaryAddress"))} placeholder="0x…" required className="h-11 font-mono text-base md:text-base" />
            </Field>
          )}

          </div>

          {walletAvailable && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {account ? (
                <span className="text-muted-foreground">Paying from <span className="font-mono text-foreground">{account.slice(0, 6)}…{account.slice(-4)}</span></span>
              ) : (
                <Button type="button" variant="outline" onClick={connect} className="h-11">
                  Connect wallet to use test USDC
                </Button>
              )}
              {!account && walletError && (
                <span className="text-destructive">{walletError}</span>
              )}
            </div>
          )}

          </>
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

          <div className="mt-2 flex gap-3">
            {page > 0 && (
              <Button type="button" variant="outline" disabled={saving} onClick={() => setPage((n) => n - 1)} className="h-12 px-5">
                Back
              </Button>
            )}
            {page < 2 ? (
              <Button type="button" onClick={next} className="h-12 flex-1">
                Next
              </Button>
            ) : (
              <Button type="submit" disabled={saving} className="h-12 flex-1">
                {saving ? step ?? "Saving…" : account ? `Lock ${form.stakeUsdc || "0"} USDC and promise` : "Make the promise"}
              </Button>
            )}
          </div>
        </form>
    </div>
  );
}
