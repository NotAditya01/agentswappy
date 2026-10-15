"use client";

import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, controlClass } from "@/components/field";
import { DEMO_CHARITY, DEMO_MAKER } from "@/lib/demo";
import { toLocalInput } from "@/lib/format";
import type { PromiseDraft, ProofType } from "@/lib/types";

const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

const empty = {
  description: "",
  deadline: toLocalInput(tomorrow),
  proofType: "github_commits" as ProofType,
  stakeUsdc: "5.00",
  makerAddress: DEMO_MAKER,
  beneficiaryName: "Demo charity",
  beneficiaryAddress: DEMO_CHARITY,
  owner: "",
  repo: "",
  minCommits: "1",
  author: "",
  since: "",
  claim: "",
  activity: "run",
  minDistanceKm: "5",
};

export function PromiseForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const [form, setForm] = useState(empty);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof empty>(key: K, value: (typeof empty)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
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
      makerAddress: form.makerAddress,
      beneficiaryName: form.beneficiaryName,
      beneficiaryAddress: form.beneficiaryAddress,
    };

    if (form.proofType === "github_commits") {
      const since = form.since ? new Date(form.since).toISOString() : undefined;
      draft.github = {
        owner: form.owner,
        repo: form.repo,
        minCommits: Number(form.minCommits),
        ...(form.author.trim() ? { author: form.author.trim() } : {}),
        ...(since ? { since } : {}),
      };
    } else if (form.proofType === "image") {
      draft.image = { claim: form.claim };
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
      if (!res.ok) throw new Error(data.error || "Could not create the promise.");

      if (form.proofType === "image" && file) {
        const body = new FormData();
        body.append("image", file);
        const upload = await fetch(`/api/promises/${data.id}/proof`, { method: "POST", body });
        const uploaded = await upload.json();
        if (!upload.ok) throw new Error(uploaded.error || "The promise was created, but the photo upload failed.");
      }

      setForm({ ...empty, deadline: toLocalInput(new Date(Date.now() + 24 * 60 * 60 * 1000)) });
      setFile(null);
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setSaving(false);
  }

  return (
    <Card>
      <CardHeader>
        <p className="font-mono text-xs font-medium tracking-[0.06em] uppercase">
          <span className="text-primary">01</span>
          <span className="ml-3 text-muted-foreground">New promise</span>
        </p>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <Field label="Description" hint="What you are promising to do.">
            <textarea
              value={form.description}
              onChange={(event) => set("description", event.target.value)}
              required
              rows={3}
              placeholder="I will ship one commit to my repo."
              className={`${controlClass} h-auto py-2`}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Deadline">
              <Input type="datetime-local" value={form.deadline} onChange={(event) => set("deadline", event.target.value)} required className="h-9 font-mono" />
            </Field>
            <Field label="Stake (USDC)" hint="Recorded only. Nothing is transferred.">
              <Input value={form.stakeUsdc} onChange={(event) => set("stakeUsdc", event.target.value)} inputMode="decimal" required className="h-9 font-mono" />
            </Field>
          </div>

          <Field label="Proof type">
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
                  onClick={() => set("proofType", value)}
                  className={`h-9 border font-mono text-xs tracking-wide uppercase ${form.proofType === value ? "border-primary bg-primary text-primary-foreground" : "border-input hover:border-primary"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>

          {form.proofType === "github_commits" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Owner" hint="Public GitHub user or org.">
                <Input value={form.owner} onChange={(event) => set("owner", event.target.value)} placeholder="vercel" required className="h-9 font-mono" />
              </Field>
              <Field label="Repo">
                <Input value={form.repo} onChange={(event) => set("repo", event.target.value)} placeholder="next.js" required className="h-9 font-mono" />
              </Field>
              <Field label="Minimum commits">
                <Input value={form.minCommits} onChange={(event) => set("minCommits", event.target.value)} inputMode="numeric" required className="h-9 font-mono" />
              </Field>
              <Field label="Author" hint="Optional GitHub username.">
                <Input value={form.author} onChange={(event) => set("author", event.target.value)} placeholder="optional" className="h-9 font-mono" />
              </Field>
              <Field label="Count commits after" hint="Blank starts the window when you create the promise.">
                <Input type="datetime-local" value={form.since} onChange={(event) => set("since", event.target.value)} className="h-9 font-mono" />
              </Field>
            </div>
          )}

          {form.proofType === "image" && (
            <div className="flex flex-col gap-4">
              <Field label="What the photo must show">
                <textarea
                  value={form.claim}
                  onChange={(event) => set("claim", event.target.value)}
                  required
                  rows={3}
                  placeholder="A photo of a finished 5k race bib."
                  className={`${controlClass} h-auto py-2`}
                />
              </Field>
              <Field label="Photo" hint="Optional now. You can upload it from the card before the check. JPEG, PNG, WebP, or GIF under 4 MB.">
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className={`${controlClass} py-1.5`} />
              </Field>
            </div>
          )}

          {form.proofType === "strava" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Activity" hint="The Strava checker is a stub this week. A check stays pending.">
                <Input value={form.activity} onChange={(event) => set("activity", event.target.value)} placeholder="run" required className="h-9 font-mono" />
              </Field>
              <Field label="Minimum km" hint="Optional.">
                <Input value={form.minDistanceKm} onChange={(event) => set("minDistanceKm", event.target.value)} inputMode="decimal" className="h-9 font-mono" />
              </Field>
            </div>
          )}

          <Field label="Refund address" hint="Where a kept stake would return. Demo address, not a live wallet.">
            <Input value={form.makerAddress} onChange={(event) => set("makerAddress", event.target.value)} required className="h-9 font-mono" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Beneficiary" hint="Friend or charity if the promise breaks.">
              <Input value={form.beneficiaryName} onChange={(event) => set("beneficiaryName", event.target.value)} required className="h-9 font-mono" />
            </Field>
            <Field label="Beneficiary address">
              <Input value={form.beneficiaryAddress} onChange={(event) => set("beneficiaryAddress", event.target.value)} required className="h-9 font-mono" />
            </Field>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" disabled={saving} className="h-9 font-mono tracking-wider uppercase">
            <Plus /> {saving ? "Saving..." : "Stake promise"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
