"use client";

import { useEffect, useState } from "react";
import { buttonVariants } from "@/components/ui/button";

const RESULT: Record<string, string> = {
  connected: "Strava connected. Check proof when you're ready.",
  denied: "Strava access was not granted.",
  "missing-scope": "Strava needs access to all your activities (including private ones) to check this promise.",
  error: "Strava didn't accept the login. Try connecting again.",
};

type Status = { configured: boolean; connected: boolean; athlete: string | null };

export function StravaConnect({ promiseId, disabled }: { promiseId: string; disabled: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("strava");
    if (value && window.location.hash === `#promise-${promiseId}` && RESULT[value]) setResult(RESULT[value]);
  }, [promiseId]);

  useEffect(() => {
    fetch(`/api/strava/status?promise=${encodeURIComponent(promiseId)}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(setStatus)
      .catch(() => setError("Couldn't load the Strava status."));
  }, [promiseId]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!status) return <p className="text-sm text-muted-foreground">Loading Strava status…</p>;
  if (!status.configured) {
    return <p className="text-sm text-muted-foreground">Strava isn&apos;t configured on this site yet, so this promise can&apos;t be checked.</p>;
  }
  return (
    <div className="flex flex-col gap-2 text-sm">
      {result && <p role="status">{result}</p>}
      <p>
        {status.connected
          ? `Strava connected${status.athlete ? ` as ${status.athlete}` : ""}.`
          : "Connect Strava so Swappy can read your activities between now and the deadline."}
      </p>
      {!disabled && (
        <a
          href={`/api/strava/connect?promise=${encodeURIComponent(promiseId)}`}
          className={`${buttonVariants({ variant: "outline" })} h-11 w-full sm:w-auto`}
        >
          {status.connected ? "Reconnect Strava" : "Connect Strava"}
        </a>
      )}
    </div>
  );
}
