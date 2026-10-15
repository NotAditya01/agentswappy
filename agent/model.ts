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
