import assert from "node:assert/strict";
import { test } from "node:test";
import { compressUntilSmall, fitWithin, TARGET_PHOTO_BYTES } from "./shrink.ts";

test("fitWithin caps the long side at 1600 and keeps the aspect ratio", () => {
  assert.deepEqual(fitWithin(4032, 3024), { width: 1600, height: 1200 });
  assert.deepEqual(fitWithin(3000, 4000), { width: 1200, height: 1600 });
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
});

test("quality steps down until the photo fits under the target", async () => {
  const tried: number[] = [];
  const blob = await compressUntilSmall(async (quality, scale) => {
    tried.push(quality);
    return new Blob([new Uint8Array(Math.round(2_400_000 * quality * quality * scale))]);
  });
  assert.ok(blob.size <= TARGET_PHOTO_BYTES);
  assert.ok(tried.length > 1);
  assert.ok(tried[0] > tried[tried.length - 1]);
});

test("falls back to a smaller size when quality alone is not enough", async () => {
  const scales = new Set<number>();
  const blob = await compressUntilSmall(async (_quality, scale) => {
    scales.add(scale);
    return new Blob([new Uint8Array(scale === 1 ? 900_000 : 400_000)]);
  });
  assert.ok(blob.size <= TARGET_PHOTO_BYTES);
  assert.ok(scales.has(0.75));
});

test("gives a clear error when nothing fits", async () => {
  await assert.rejects(() => compressUntilSmall(async () => new Blob([new Uint8Array(2_000_000)])), /650 KB/);
});
