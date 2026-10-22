import { getPromise } from "@/lib/store";
import { STRAVA_SCOPE, appOrigin, exchangeCode, readState, saveTokens, stravaConfig } from "@/lib/strava";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function back(req: Request, result: string, id?: string) {
  const url = new URL(appOrigin(req));
  url.searchParams.set("strava", result);
  if (id) url.hash = `promise-${id}`;
  return Response.redirect(url.toString(), 302);
}

export async function GET(req: Request) {
  const config = stravaConfig();
  if (!config) return back(req, "not-configured");
  const params = new URL(req.url).searchParams;
  const id = readState(params.get("state") || "", config.clientSecret);
  if (!id) return back(req, "bad-state");
  if (params.get("error")) return back(req, "denied", id);
  const scopes = (params.get("scope") || "").split(",");
  if (!scopes.includes(STRAVA_SCOPE)) return back(req, "missing-scope", id);
  const code = params.get("code");
  if (!code) return back(req, "denied", id);
  const promise = await getPromise(id);
  if (!promise || promise.proofType !== "strava") return back(req, "bad-state");
  try {
    await saveTokens(id, await exchangeCode(code));
  } catch {
    return back(req, "error", id);
  }
  return back(req, "connected", id);
}
