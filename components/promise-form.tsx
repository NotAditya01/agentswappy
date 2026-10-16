"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, controlClass } from "@/components/field";
import { toLocalInput } from "@/lib/format";
import type { PromiseDraft, ProofType } from "@/lib/types";

const SIMULATED_REFUND = "0x1111111111111111111111111111111111111111";
const SIMULATED_PAYOUT = "0x2222222222222222222222222222222222222222";
const MAX_PHOTO_BYTES = 4_000_000;

const PROOF_HELP: Record<ProofType, string> = {
  github_commits: "We look up public commits on the repository you name, from the start date through the deadline.",
  image: "Upload a photo. The check sends that image to Gemini, and Swappy decides if it shows what you described.",
  strava: "Strava is not connected yet. A check stays unfinished, and nothing is settled.",
};

type FormState = {
  description: string;
  deadline: string;
  proofType: ProofType;
  stakeUsdc: string;
  beneficiaryName: string;
  repo: string;
  minCommits: string;
  since: string;
  claim: string;
  activity: string;
  minDistanceKm: string;
};

function blankForm(): FormState {
  return {
    description: "",
    deadline: toLocalInput(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
    proofType: "github_commits",
    stakeUsdc: "5.00",
    beneficiaryName: "A friend",
    repo: "",
    minCommits: "1",
    since: "",
    claim: "",
    activity: "run",
    minDistanceKm: "",
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

export function PromiseForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const [form, setForm] = useState(blankForm);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exampleNote, setExampleNote] = useState(false);

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
    const draft: PromiseDraft = {
      description: form.description,
      deadline: deadline.toISOString(),
      proofType: form.proofType,
      stakeUsdc: form.stakeUsdc,
      makerAddress: SIMULATED_REFUND,
      beneficiaryName: form.beneficiaryName,
      beneficiaryAddress: SIMULATED_PAYOUT,
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
    } else if (form.proofType === "image") {
      draft.image = { claim: form.claim };
      if (file && file.size > MAX_PHOTO_BYTES) {
        setError("Image must be 4 MB or smaller.");
        setSaving(false);
        return;
      }
    } else {
      draft.strava = {
        activity: form.activity,
        ...(form.minDistanceKm.trim() ? { minDistanceKm: Number(form.minDistanceKm) } : {}),
      };
    }

    try {
      const res = await fetch("/api/promises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save the promise.");

      if (form.proofType === "image" && file) {
        const body = new FormData();
        body.append("image", file);
        const upload = await fetch(`/api/promises/${data.id}/proof`, { method: "POST", body });
        const uploaded = await upload.json();
        if (!upload.ok) throw new Error(uploaded.error || "The promise was saved, but the photo upload failed.");
      }

      setForm(blankForm());
      setFile(null);
      setExampleNote(false);
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
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
            <Field label="Stake (USDC)" hint="Simulated. Nothing is charged.">
              <Input value={form.stakeUsdc} onChange={(event) => set("stakeUsdc", event.target.value)} inputMode="decimal" required className="h-11 text-base md:text-base" />
            </Field>
          </div>

          <Field label="How will you prove it?" hint={PROOF_HELP[form.proofType]}>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["github_commits", "GitHub"],
                  ["image", "Photo"],
                  ["strava", "Strava"],
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
              <Field label="Photo" hint="JPEG, PNG, WebP, or GIF, up to 4 MB. You can add it later.">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={(event) => {
                    const next = event.target.files?.[0] ?? null;
                    if (next && next.size > MAX_PHOTO_BYTES) {
                      setError("Image must be 4 MB or smaller.");
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

          {form.proofType === "strava" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Activity">
                <Input value={form.activity} onChange={(event) => set("activity", event.target.value)} placeholder="run" required className="h-11 text-base md:text-base" />
              </Field>
              <Field label="Minimum kilometers" hint="Optional.">
                <Input value={form.minDistanceKm} onChange={(event) => set("minDistanceKm", event.target.value)} inputMode="decimal" className="h-11 text-base md:text-base" />
              </Field>
            </div>
          )}

          <Field label="Who gets the stake if you break it?">
            <Input value={form.beneficiaryName} onChange={(event) => set("beneficiaryName", event.target.value)} placeholder="A friend" required className="h-11 text-base md:text-base" />
          </Field>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" disabled={saving} className="h-11 w-full sm:w-fit">
            {saving ? "Saving…" : "Make the promise"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
