import type { Metadata } from "next";
import { getPromise } from "@/lib/store";
import { formatUsdc } from "@/lib/format";
import { SharedPromise } from "@/components/shared-promise";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const p = await getPromise(id).catch(() => null);
  if (!p) return { title: "Promise not found · Proof of Promise" };
  const title = `${p.description} · Proof of Promise`;
  const description = `${formatUsdc(p.stakeUsdc)} USDC on the line. If it's broken, it goes to ${p.beneficiaryName}. Swappy checks the proof.`;
  return { title, description, openGraph: { title, description, images: ["/logo.png"] }, twitter: { card: "summary", title, description } };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SharedPromise id={id} />;
}
