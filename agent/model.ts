export const MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";

// Tried in order. The fallback only runs when the model before it hits its daily quota.
export function modelChain(env: Record<string, string | undefined> = process.env): string[] {
  const primary = env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";
  const fallback = env.GEMINI_FALLBACK_MODEL?.trim();
  return fallback && fallback !== primary ? [primary, fallback] : [primary];
}

export function requireGeminiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    throw new Error("GEMINI_API_KEY is not set. Add it and try the check again. Nothing was settled.");
  }
  return key;
}

export function geminiFailure(prefix: string, err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  const key = process.env.GEMINI_API_KEY?.trim();
  const cleaned = (key ? raw.split(key).join("the API key") : raw).replace(/\s+/g, " ").slice(0, 300);
  const tail = /Nothing was settled\.?\s*$/.test(cleaned) ? "" : " Nothing was settled.";
  return new Error(`${prefix} ${cleaned}${tail}`);
}

export const GEMINI_DAILY_QUOTA = "Gemini's daily free quota for this app is used up. It resets within a day. Nothing was settled.";

function isDailyQuota(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /PerDay/i.test(message);
}

export const GEMINI_BUSY = "Gemini is busy right now. Try again in a minute. Nothing was settled.";

const CALL_TIMEOUT_MS = 45_000;
const RETRY_DELAY_MS = 1_500;

class GeminiTimeout extends Error {}

function isRetryable(err: unknown): boolean {
  if (err instanceof GeminiTimeout) return true;
  const status = (err as { status?: unknown })?.status;
  if (typeof status === "number") return status === 429 || status >= 500;
  const message = err instanceof Error ? err.message : String(err);
  return /"code":\s*(429|5\d\d)|\b(429|50[0-4])\b|UNAVAILABLE|RESOURCE_EXHAUSTED/.test(message);
}

async function attempt<T>(call: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new GeminiTimeout(`Gemini did not answer within ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([call(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function callGemini<T>(
  call: (signal: AbortSignal, model: string) => Promise<T>,
  deadline?: number,
  models: string[] = modelChain(),
): Promise<T> {
  for (let i = 0; i < models.length; i++) {
    try {
      return await callModel((signal) => call(signal, models[i]), deadline);
    } catch (err) {
      const last = i === models.length - 1;
      if (!last && err instanceof Error && err.message === GEMINI_DAILY_QUOTA) continue;
      throw err;
    }
  }
  throw new Error(GEMINI_BUSY);
}

async function callModel<T>(call: (signal: AbortSignal) => Promise<T>, deadline?: number): Promise<T> {
  const budget = () => (deadline ? deadline - Date.now() : Infinity);

  for (let tries = 0; ; tries++) {
    const timeoutMs = Math.min(CALL_TIMEOUT_MS, budget());
    if (timeoutMs < 2_000) throw new Error(GEMINI_BUSY);
    try {
      return await attempt(call, timeoutMs);
    } catch (err) {
      if (isDailyQuota(err)) throw new Error(GEMINI_DAILY_QUOTA);
      if (!isRetryable(err)) throw err;
      if (tries >= 1 || budget() < RETRY_DELAY_MS + 2_000) throw new Error(GEMINI_BUSY);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}
