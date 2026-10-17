export const TARGET_PHOTO_BYTES = 650_000;
export const MAX_RAW_PHOTO_BYTES = 25_000_000;
const MAX_SIDE = 1600;
const QUALITIES = [0.85, 0.75, 0.65, 0.55, 0.45, 0.35];

export function fitWithin(width: number, height: number, maxSide = MAX_SIDE) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function compressUntilSmall(
  encode: (quality: number, scale: number) => Promise<Blob>,
  target = TARGET_PHOTO_BYTES,
): Promise<Blob> {
  for (const scale of [1, 0.75, 0.5]) {
    for (const quality of QUALITIES) {
      const blob = await encode(quality, scale);
      if (blob.size <= target) return blob;
    }
  }
  throw new Error("This photo is too detailed to shrink under 650 KB. Try a different one.");
}

export async function shrinkPhoto(file: File): Promise<File> {
  if (file.size > MAX_RAW_PHOTO_BYTES) throw new Error("Image must be 25 MB or smaller.");
  if (file.size <= TARGET_PHOTO_BYTES && file.type !== "image/gif") return file;

  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const base = fitWithin(bitmap.width, bitmap.height);
    const blob = await compressUntilSmall((quality, scale) => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(base.width * scale));
      canvas.height = Math.max(1, Math.round(base.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("This browser cannot resize photos.");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((out) => (out ? resolve(out) : reject(new Error("Could not compress the photo."))), "image/jpeg", quality),
      );
    });
    const name = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}
