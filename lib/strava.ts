import { createHmac, timingSafeEqual } from "crypto";
import { redis, redisConfig } from "./redis";

export const STRAVA_SCOPE = "activity:read_all";
const TOKEN_PREFIX = "pop:strava:";

export type StravaTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  athleteId: number | null;
  athleteName: string | null;
  connectedAt: string;
};

export type StravaActivity = {
  id: number;
  name: string;
  type: string;
  sport_type?: string;
  distance: number;
  start_date: string;
};

export function stravaConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = (process.env.STRAVA_CLIENT_ID || "").trim();
  const clientSecret = (process.env.STRAVA_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret || !redisConfig()) return null;
  return { clientId, clientSecret };
}

export function appOrigin(req: Request): string {
  const fixed = (process.env.APP_URL || "").trim();
  if (fixed) return fixed.replace(/\/+$/, "");
  return new URL(req.url).origin;
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex").slice(0, 32);
}

export function makeState(promiseId: string, secret: string): string {
  return `${promiseId}.${sign(promiseId, secret)}`;
}

export function readState(state: string, secret: string): string | null {
  const [id, mac] = state.split(".");
  if (!id || !mac) return null;
  const expected = sign(id, secret);
  if (mac.length !== expected.length) return null;
  return timingSafeEqual(Buffer.from(mac), Buffer.from(expected)) ? id : null;
}

export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const url = new URL("https://www.strava.com/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("approval_prompt", "auto");
  url.searchParams.set("scope", STRAVA_SCOPE);
  url.searchParams.set("state", state);
  return url.toString();
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete?: { id: number; firstname?: string; lastname?: string };
  message?: string;
};

async function tokenRequest(body: Record<string, string>, fetcher: typeof fetch): Promise<TokenResponse> {
  const res = await fetcher("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => null)) as TokenResponse | null;
  if (!res.ok || !data?.access_token) throw new Error(`Strava token error: ${data?.message ?? `HTTP ${res.status}`}`);
  return data;
}

export async function exchangeCode(code: string, fetcher: typeof fetch = fetch): Promise<StravaTokens> {
  const config = stravaConfig();
  if (!config) throw new Error("Strava is not configured.");
  const data = await tokenRequest(
    { client_id: config.clientId, client_secret: config.clientSecret, code, grant_type: "authorization_code" },
    fetcher,
  );
  const name = [data.athlete?.firstname, data.athlete?.lastname].filter(Boolean).join(" ");
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at,
    athleteId: data.athlete?.id ?? null,
    athleteName: name || null,
    connectedAt: new Date().toISOString(),
  };
}

export async function saveTokens(promiseId: string, tokens: StravaTokens): Promise<void> {
  await redis(["SET", TOKEN_PREFIX + promiseId, JSON.stringify(tokens)]);
}

export async function loadTokens(promiseId: string): Promise<StravaTokens | null> {
  if (!redisConfig()) return null;
  const raw = await redis<string | null>(["GET", TOKEN_PREFIX + promiseId]);
  return raw ? (JSON.parse(raw) as StravaTokens) : null;
}

export async function freshTokens(
  tokens: StravaTokens,
  fetcher: typeof fetch = fetch,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<{ tokens: StravaTokens; refreshed: boolean }> {
  if (tokens.expiresAt - 60 > nowSec) return { tokens, refreshed: false };
  const config = stravaConfig();
  if (!config) throw new Error("Strava is not configured.");
  const data = await tokenRequest(
    {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: tokens.refreshToken,
      grant_type: "refresh_token",
    },
    fetcher,
  );
  return {
    tokens: { ...tokens, accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: data.expires_at },
    refreshed: true,
  };
}

export async function fetchActivities(
  accessToken: string,
  afterIso: string,
  beforeIso: string,
  fetcher: typeof fetch = fetch,
): Promise<StravaActivity[]> {
  const after = Math.floor(new Date(afterIso).getTime() / 1000);
  const before = Math.floor(new Date(beforeIso).getTime() / 1000);
  const all: StravaActivity[] = [];
  for (let page = 1; page <= 5; page++) {
    const url = `https://www.strava.com/api/v3/athlete/activities?after=${after}&before=${before}&per_page=100&page=${page}`;
    const res = await fetcher(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    if (!res.ok) throw new Error(`Strava activities error: HTTP ${res.status}`);
    const batch = (await res.json()) as StravaActivity[];
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

const ALIASES: Record<string, string> = {
  running: "run",
  jog: "run",
  jogging: "run",
  cycling: "ride",
  cycle: "ride",
  bike: "ride",
  biking: "ride",
  swimming: "swim",
  walking: "walk",
  hiking: "hike",
};

export function normalizeActivity(value: string): string {
  const key = value.toLowerCase().replace(/[^a-z]/g, "");
  return ALIASES[key] ?? key;
}

export function activityMatches(wanted: string, activity: StravaActivity): boolean {
  const want = normalizeActivity(wanted);
  if (!want) return false;
  const sport = (activity.sport_type || "").toLowerCase();
  const type = (activity.type || "").toLowerCase();
  return type === want || sport === want || sport.endsWith(want);
}

export type StravaMatch = {
  qualifying: StravaActivity[];
  sameType: number;
  total: number;
  needed: number;
  goalMet: boolean;
};

export function matchActivities(
  activities: StravaActivity[],
  criteria: { activity: string; minDistanceKm?: number; minCount?: number },
): StravaMatch {
  const needed = criteria.minCount && criteria.minCount > 0 ? criteria.minCount : 1;
  const minMeters = (criteria.minDistanceKm ?? 0) * 1000;
  const sameType = activities.filter((a) => activityMatches(criteria.activity, a));
  const qualifying = sameType.filter((a) => a.distance >= minMeters);
  return { qualifying, sameType: sameType.length, total: activities.length, needed, goalMet: qualifying.length >= needed };
}
