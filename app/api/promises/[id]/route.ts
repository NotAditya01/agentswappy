import { withChainState } from "@/lib/chain-state";
import { getPromise } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const promise = await getPromise(id);
  if (!promise) return Response.json({ error: "Promise not found." }, { status: 404 });
  const [withChain] = await withChainState([promise]);
  return Response.json(withChain);
}
