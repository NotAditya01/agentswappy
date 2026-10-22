import { getPromise } from "@/lib/store";
import { appOrigin, authorizeUrl, makeState, stravaConfig } from "@/lib/strava";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const config = stravaConfig();
  if (!config) return Response.json({ error: "Strava isn't configured on this site." }, { status: 503 });
  const id = new URL(req.url).searchParams.get("promise") || "";
  const promise = id ? await getPromise(id) : null;
  if (!promise) return Response.json({ error: "Promise not found." }, { status: 404 });
  if (promise.proofType !== "strava") return Response.json({ error: "This promise is not checked with Strava." }, { status: 400 });
  if (promise.verdict === "kept" || promise.verdict === "broken") {
    return Response.json({ error: "This promise is already settled." }, { status: 409 });
  }
  const redirectUri = `${appOrigin(req)}/api/strava/callback`;
  return Response.redirect(authorizeUrl(config.clientId, redirectUri, makeState(promise.id, config.clientSecret)), 302);
}
