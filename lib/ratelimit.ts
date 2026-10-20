import { redis as defaultRedis } from "./redis";

type Run = <T = unknown>(command: (string | number)[]) => Promise<T>;

export const SENDS_PER_IP_PER_HOUR = 3;
export const SENDS_PER_DAY = 10;

export type LimitResult = { ok: true } | { ok: false; error: string };

async function take(run: Run, key: string, limit: number, ttl: number): Promise<boolean> {
  const count = Number(await run(["INCR", key]));
  if (count === 1) await run(["EXPIRE", key, ttl]);
  if (count > limit) {
    await run(["DECR", key]);
    return false;
  }
  return true;
}

// Counts one agent-wallet send. Per IP per hour first, then the global daily budget.
export async function takeSendSlot(ip: string, now = Date.now(), run: Run = defaultRedis): Promise<LimitResult> {
  const hour = Math.floor(now / 3_600_000);
  const day = Math.floor(now / 86_400_000);
  const ipKey = `ratelimit:send:ip:${ip}:${hour}`;

  if (!(await take(run, ipKey, SENDS_PER_IP_PER_HOUR, 3_600))) {
    return { ok: false, error: `Swappy's wallet allows ${SENDS_PER_IP_PER_HOUR} sends per hour from one address. Try again later or send from your own wallet.` };
  }
  if (!(await take(run, `ratelimit:send:day:${day}`, SENDS_PER_DAY, 86_400))) {
    await run(["DECR", ipKey]);
    return { ok: false, error: `Swappy's wallet has hit its limit of ${SENDS_PER_DAY} sends today. Try tomorrow or send from your own wallet.` };
  }
  return { ok: true };
}

export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip")?.trim() || "unknown";
}
