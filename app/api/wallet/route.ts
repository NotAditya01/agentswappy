import { createWallet, getWalletAddress, getWalletBalance } from "@/agent/wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const address = getWalletAddress();
  if (!address) return Response.json({ address: null });

  const balance = await getWalletBalance().catch(() => "unavailable");
  return Response.json({ address, balance });
}

export async function POST() {
  return Response.json({ address: createWallet() });
}
