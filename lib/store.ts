import fs from "fs/promises";
import os from "os";
import path from "path";
import { redis, redisConfig } from "./redis";
import type { CreatePromiseInput, ImageProof, PromiseRecord, PromiseUpdate } from "./types";

const IS_VERCEL = Boolean(process.env.VERCEL);
const DATA_DIR = IS_VERCEL
  ? path.join(os.tmpdir(), "proof-of-promise")
  : path.join(process.cwd(), "data");
const PROOF_DIR = path.join(DATA_DIR, "proofs");
const DB_PATH = path.join(DATA_DIR, "promises.json");
const PROMISES_KEY = "pop:promises";
const PROOF_PREFIX = "pop:proof:";
const MAX_IMAGE_BYTES = 4_000_000;
const MAX_REDIS_IMAGE_BYTES = 700_000;

export function storageKind(): "redis" | "file" {
  return redisConfig() ? "redis" : "file";
}

function draftToRecord(input: CreatePromiseInput): PromiseRecord {
  return {
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
}

let queue: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readFileDb(): Promise<PromiseRecord[]> {
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PromiseRecord[]) : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function writeFileDb(promises: PromiseRecord[]) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${DB_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(promises, null, 2));
  await fs.rename(tmp, DB_PATH);
}

async function readAll(): Promise<PromiseRecord[]> {
  if (!redisConfig()) return readFileDb();
  const values = await redis<string[] | null>(["HVALS", PROMISES_KEY]);
  return (values ?? []).map((value) => JSON.parse(value) as PromiseRecord);
}

async function readOne(id: string): Promise<PromiseRecord | null> {
  if (!redisConfig()) return (await readFileDb()).find((promise) => promise.id === id) ?? null;
  const value = await redis<string | null>(["HGET", PROMISES_KEY, id]);
  return value ? (JSON.parse(value) as PromiseRecord) : null;
}

async function writeOne(record: PromiseRecord) {
  if (redisConfig()) {
    await redis(["HSET", PROMISES_KEY, record.id, JSON.stringify(record)]);
    return;
  }
  const promises = await readFileDb();
  const index = promises.findIndex((promise) => promise.id === record.id);
  if (index === -1) promises.push(record);
  else promises[index] = record;
  await writeFileDb(promises);
}

export async function listPromises(): Promise<PromiseRecord[]> {
  const promises = await readAll();
  return promises.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getPromise(id: string): Promise<PromiseRecord | null> {
  return readOne(id);
}

export async function createPromise(input: CreatePromiseInput): Promise<PromiseRecord> {
  const record = draftToRecord(input);

  await withLock(() => writeOne(record));

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
    const promise = await readOne(id);
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
    await writeOne(promise);
    return { state: "ready" as const, promise: structuredClone(promise) };
  });
}

export async function savePromise(id: string, patch: PromiseUpdate): Promise<PromiseRecord | null> {
  return withLock(async () => {
    const promise = await readOne(id);
    if (!promise) return null;
    Object.assign(promise, patch);
    promise.id = id;
    await writeOne(promise);
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

export async function readProofBytes(storedName: string): Promise<Buffer> {
  const file = proofFilePath(storedName);
  if (!redisConfig()) return fs.readFile(file);
  const value = await redis<string | null>(["GET", PROOF_PREFIX + path.basename(file)]);
  if (!value) throw new Error("The photo is missing from storage.");
  return Buffer.from(value, "base64");
}

async function writeProofBytes(storedName: string, bytes: Buffer) {
  const file = proofFilePath(storedName);
  if (redisConfig()) {
    await redis(["SET", PROOF_PREFIX + path.basename(file), bytes.toString("base64")]);
    return;
  }
  await fs.mkdir(PROOF_DIR, { recursive: true });
  await fs.writeFile(file, bytes);
}

async function deleteProofBytes(storedName: string) {
  const file = proofFilePath(storedName);
  if (redisConfig()) await redis(["DEL", PROOF_PREFIX + path.basename(file)]);
  else await fs.rm(file, { force: true });
}

export async function attachImageProof(
  id: string,
  file: { fileName: string; mimeType: string; bytes: Buffer },
): Promise<PromiseRecord | null> {
  const ext = MIME_EXT[file.mimeType];
  if (!ext) throw new Error("Upload a JPEG, PNG, WebP, or GIF.");
  if (file.bytes.length === 0) throw new Error("That image is empty.");
  if (file.bytes.length > MAX_IMAGE_BYTES) throw new Error("Image must be 4 MB or smaller.");
  if (redisConfig() && file.bytes.length > MAX_REDIS_IMAGE_BYTES) {
    throw new Error("Image must be 700 KB or smaller. Try a smaller photo or a screenshot.");
  }

  return withLock(async () => {
    const promise = await readOne(id);
    if (!promise) return null;
    if (promise.proofType !== "image") throw new Error("Only photo promises accept an image.");
    if (promise.verdict === "kept" || promise.verdict === "broken") {
      throw new Error("This promise is already settled.");
    }

    if (promise.imageProof) await deleteProofBytes(promise.imageProof.storedName);
    const storedName = `${id}.${ext}`;
    await writeProofBytes(storedName, file.bytes);
    const imageProof: ImageProof = {
      fileName: path.basename(file.fileName).slice(0, 180) || `proof.${ext}`,
      mimeType: file.mimeType,
      storedName,
      bytes: file.bytes.length,
      uploadedAt: new Date().toISOString(),
    };
    promise.imageProof = imageProof;
    await writeOne(promise);
    return structuredClone(promise);
  });
}
