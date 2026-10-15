import fs from "fs/promises";
import { attachImageProof, getPromise, proofFilePath } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sniffMime(bytes: Buffer, declared: string): string | null {
  const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (allowed.includes(declared)) return declared;
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 3 && bytes.toString("ascii", 0, 3) === "GIF") return "image/gif";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const promise = await getPromise(id);
  if (!promise?.imageProof) return Response.json({ error: "No photo uploaded." }, { status: 404 });

  const bytes = await fs.readFile(proofFilePath(promise.imageProof.storedName));
  return new Response(bytes, {
    headers: {
      "Content-Type": promise.imageProof.mimeType,
      "Cache-Control": "private, max-age=60",
    },
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const promise = await getPromise(id);
  if (!promise) return Response.json({ error: "Promise not found." }, { status: 404 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Expected an image upload." }, { status: 400 });
  }

  const file = form.get("image");
  if (!(file instanceof File)) return Response.json({ error: "Choose an image file." }, { status: 400 });
  if (file.size > 4_000_000) return Response.json({ error: "Image must be 4 MB or smaller." }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const mimeType = sniffMime(bytes, file.type);
  if (!mimeType) return Response.json({ error: "Upload a JPEG, PNG, WebP, or GIF." }, { status: 400 });

  try {
    const updated = await attachImageProof(id, { fileName: file.name, mimeType, bytes });
    if (!updated) return Response.json({ error: "Promise not found." }, { status: 404 });
    return Response.json(updated);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
