import { loadTokens, stravaConfig } from "@/lib/strava";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const configured = Boolean(stravaConfig());
  const id = new URL(req.url).searchParams.get("promise") || "";
  if (!configured || !id) return Response.json({ configured, connected: false, athlete: null });
  const tokens = await loadTokens(id);
  return Response.json({ configured, connected: Boolean(tokens), athlete: tokens?.athleteName ?? null });
}
