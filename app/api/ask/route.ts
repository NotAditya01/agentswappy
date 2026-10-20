import { parseAsk } from "@/agent/ask";
import { agentAddress } from "@/agent/transfer";
import { listPromises } from "@/lib/store";
import { AGENT_CAP } from "@/lib/transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { prompt?: string } | null;
  try {
    const intent = await parseAsk(String(body?.prompt ?? ""), await listPromises());
    return Response.json({ intent, agentAddress: agentAddress(), agentCap: AGENT_CAP });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Could not read that request." }, { status: 502 });
  }
}
