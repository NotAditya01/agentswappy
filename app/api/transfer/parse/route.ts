import { agentAddress, parseTransferPrompt } from "@/agent/transfer";
import { AGENT_CAP } from "@/lib/transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  return Response.json({ agentAddress: agentAddress(), agentCap: AGENT_CAP, network: "base-sepolia" });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { prompt?: string } | null;
  try {
    const result = await parseTransferPrompt(String(body?.prompt ?? ""));
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    return Response.json({ transfer: result.transfer, agentAddress: agentAddress(), agentCap: AGENT_CAP });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Could not read that request." }, { status: 502 });
  }
}
