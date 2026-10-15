export const MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash";

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
  return new Error(`${prefix} ${cleaned} Nothing was settled.`);
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

export async function callGemini<T>(call: (signal: AbortSignal) => Promise<T>, deadline?: number): Promise<T> {
  const budget = () => (deadline ? deadline - Date.now() : Infinity);

  for (let tries = 0; ; tries++) {
    const timeoutMs = Math.min(CALL_TIMEOUT_MS, budget());
    if (timeoutMs < 2_000) throw new Error(GEMINI_BUSY);
    try {
      return await attempt(call, timeoutMs);
    } catch (err) {
      if (!isRetryable(err)) throw err;
      if (tries >= 1 || budget() < RETRY_DELAY_MS + 2_000) throw new Error(GEMINI_BUSY);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}
