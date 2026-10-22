import type { ProofCheckResult, StravaCriteria, Verdict } from "../../lib/types";
import { fetchActivities, freshTokens, loadTokens, matchActivities, saveTokens, stravaConfig } from "../../lib/strava";

export type StravaQuery = StravaCriteria & { promiseId: string; createdAt: string; deadline: string };

function base(query: StravaQuery) {
  return {
    activity: query.activity,
    minDistanceKm: query.minDistanceKm ?? null,
    minCount: query.minCount ?? 1,
    from: query.createdAt,
    deadline: query.deadline,
  };
}

function unverified(query: StravaQuery, summary: string, extra: Record<string, unknown>): ProofCheckResult {
  return {
    provider: "strava",
    verified: false,
    goalMet: false,
    missingUserProof: true,
    suggestedVerdict: "pending",
    summary,
    evidence: { ...base(query), ...extra },
  };
}

export async function checkStravaActivity(
  query: StravaQuery,
  fetcher: typeof fetch = fetch,
  now = new Date(),
): Promise<ProofCheckResult> {
  if (!stravaConfig()) {
    return unverified(query, "Strava is not configured on this site, so the activity cannot be checked. Nothing is settled.", {
      configured: false,
      connected: false,
    });
  }
  const stored = await loadTokens(query.promiseId);
  if (!stored) {
    return unverified(query, "Strava is not connected for this promise. Connect Strava on the card, then check again.", {
      configured: true,
      connected: false,
    });
  }
  const { tokens, refreshed } = await freshTokens(stored, fetcher);
  if (refreshed) await saveTokens(query.promiseId, tokens);

  const deadline = new Date(query.deadline);
  const end = deadline < now ? deadline : now;
  const activities = await fetchActivities(tokens.accessToken, query.createdAt, end.toISOString(), fetcher);
  const match = matchActivities(activities, query);
  const past = now >= deadline;
  const verdict: Verdict = match.goalMet ? "kept" : past ? "broken" : "pending";
  const what = `${match.needed} ${query.activity}${query.minDistanceKm ? ` of at least ${query.minDistanceKm} km` : ""}`;
  const summary = match.goalMet
    ? `Found ${match.qualifying.length} matching Strava ${query.activity} activities, ${what} needed.`
    : `Found ${match.qualifying.length} of ${what} needed on Strava (${match.sameType} ${query.activity} activities, ${match.total} total).${past ? " The deadline has passed." : " The deadline has not passed yet."}`;

  return {
    provider: "strava",
    verified: true,
    goalMet: match.goalMet,
    missingUserProof: false,
    suggestedVerdict: verdict,
    summary,
    evidence: {
      ...base(query),
      configured: true,
      connected: true,
      athlete: tokens.athleteName,
      checkedUntil: end.toISOString(),
      totalActivities: match.total,
      sameType: match.sameType,
      qualifying: match.qualifying.slice(0, 10).map((a) => ({
        id: a.id,
        name: a.name,
        type: a.sport_type || a.type,
        km: Math.round(a.distance / 10) / 100,
        start: a.start_date,
        url: `https://www.strava.com/activities/${a.id}`,
      })),
    },
  };
}
