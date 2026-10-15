import { MODEL } from "@/agent/model";
import { createPromise, listPromises } from "@/lib/store";
import { validateCreate } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const promises = await listPromises();
  return Response.json({
    promises,
    meta: {
      hasApiKey: Boolean(process.env.GEMINI_API_KEY),
      model: MODEL,
      hasGithubToken: Boolean(process.env.GITHUB_TOKEN),
      settlement: "mock",
      network: "base-sepolia",
    },
  });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }

  const parsed = validateCreate(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const promise = await createPromise(parsed.value);
  return Response.json(promise, { status: 201 });
}
