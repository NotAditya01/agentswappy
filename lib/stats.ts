import type { PromiseRecord } from "./types";

export type Stats = { lockedUsdc: number; kept: number; backers: number };

export function statsOf(list: PromiseRecord[]): Stats {
  let lockedUsdc = 0;
  let kept = 0;
  let backers = 0;
  for (const p of list) {
    if (p.chain?.status === "open") lockedUsdc += Number(p.chain.stakeUsdc) + Number(p.chain.backedUsdc);
    if (p.verdict === "kept") kept += 1;
    backers += p.backings?.length ?? 0;
  }
  return { lockedUsdc: Math.round(lockedUsdc * 1e6) / 1e6, kept, backers };
}
