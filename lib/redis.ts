type RedisConfig = { url: string; token: string };

export function redisConfig(): RedisConfig | null {
  const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").trim();
  const token = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}

export async function redis<T = unknown>(command: (string | number)[]): Promise<T> {
  const config = redisConfig();
  if (!config) throw new Error("Redis is not configured.");
  const res = await fetch(config.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => null)) as { result?: T; error?: string } | null;
  if (!res.ok || !data || data.error) {
    throw new Error(`Storage error: ${data?.error ?? `HTTP ${res.status}`}`);
  }
  return data.result as T;
}
