import fs from "fs/promises";
import path from "path";
import type { CreatePromiseInput, ImageProof, PromiseRecord, PromiseUpdate } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const PROOF_DIR = path.join(DATA_DIR, "proofs");
const DB_PATH = path.join(DATA_DIR, "promises.json");

let queue: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readAll(): Promise<PromiseRecord[]> {
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PromiseRecord[]) : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function writeAll(promises: PromiseRecord[]) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${DB_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(promises, null, 2));
  await fs.rename(tmp, DB_PATH);
}

export async function listPromises(): Promise<PromiseRecord[]> {
  const promises = await readAll();
  return promises.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getPromise(id: string): Promise<PromiseRecord | null> {
  const promises = await readAll();
  return promises.find((promise) => promise.id === id) ?? null;
}

export async function createPromise(input: CreatePromiseInput): Promise<PromiseRecord> {
  const record: PromiseRecord = {
    id: crypto.randomUUID(),
    description: input.description,
    deadline: input.deadline,
    proofType: input.proofType,
    target: input.target,
    criteria: input.criteria,
    stakeUsdc: input.stakeUsdc,
    makerAddress: input.makerAddress,
    beneficiaryName: input.beneficiaryName,
    beneficiaryAddress: input.beneficiaryAddress,
    status: "open",
    verdict: null,
    explanation: null,
    decidedBy: null,
    trace: [],
    settlement: null,
    imageProof: null,
    createdAt: new Date().toISOString(),
    checkedAt: null,
    checkingStartedAt: null,
  };

  await withLock(async () => {
    const promises = await readAll();
    promises.push(record);
    await writeAll(promises);
  });

  return record;
}

export async function beginCheck(
  id: string,
): Promise<
  | { state: "ready"; promise: PromiseRecord }
  | { state: "missing" }
  | { state: "busy" }
  | { state: "settled"; promise: PromiseRecord }
> {
  return withLock(async () => {
    const promises = await readAll();
    const promise = promises.find((item) => item.id === id);
    if (!promise) return { state: "missing" as const };
    if (promise.verdict === "kept" || promise.verdict === "broken") {
      return { state: "settled" as const, promise: structuredClone(promise) };
    }
    if (promise.status === "checking" && promise.checkingStartedAt) {
      const age = Date.now() - new Date(promise.checkingStartedAt).getTime();
      if (age < 90_000) return { state: "busy" as const };
    }
    promise.status = "checking";
    promise.checkingStartedAt = new Date().toISOString();
    await writeAll(promises);
    return { state: "ready" as const, promise: structuredClone(promise) };
  });
}

export async function savePromise(id: string, patch: PromiseUpdate): Promise<PromiseRecord | null> {
  return withLock(async () => {
    const promises = await readAll();
    const promise = promises.find((item) => item.id === id);
    if (!promise) return null;
    Object.assign(promise, patch);
    promise.id = id;
    await writeAll(promises);
    return structuredClone(promise);
  });
}

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function proofFilePath(storedName: string): string {
  const base = path.basename(storedName);
  if (base !== storedName || base.includes("..")) throw new Error("Bad proof file.");
  const full = path.join(PROOF_DIR, base);
  if (path.dirname(full) !== PROOF_DIR) throw new Error("Bad proof file.");
  return full;
}

export async function attachImageProof(
  id: string,
  file: { fileName: string; mimeType: string; bytes: Buffer },
): Promise<PromiseRecord | null> {
  const ext = MIME_EXT[file.mimeType];
  if (!ext) throw new Error("Upload a JPEG, PNG, WebP, or GIF.");
  if (file.bytes.length === 0) throw new Error("That image is empty.");
  if (file.bytes.length > 4_000_000) throw new Error("Image must be 4 MB or smaller.");

  return withLock(async () => {
    const promises = await readAll();
    const promise = promises.find((item) => item.id === id);
    if (!promise) return null;
    if (promise.proofType !== "image") throw new Error("Only photo promises accept an image.");
    if (promise.verdict === "kept" || promise.verdict === "broken") {
      throw new Error("This promise is already settled.");
    }

    await fs.mkdir(PROOF_DIR, { recursive: true });
    if (promise.imageProof) {
      await fs.rm(proofFilePath(promise.imageProof.storedName), { force: true });
    }

    const storedName = `${id}.${ext}`;
    await fs.writeFile(proofFilePath(storedName), file.bytes);
    const imageProof: ImageProof = {
      fileName: path.basename(file.fileName).slice(0, 180) || `proof.${ext}`,
      mimeType: file.mimeType,
      storedName,
      bytes: file.bytes.length,
      uploadedAt: new Date().toISOString(),
    };
    promise.imageProof = imageProof;
    await writeAll(promises);
    return structuredClone(promise);
  });
}
