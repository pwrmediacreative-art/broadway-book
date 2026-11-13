// What a reading costs, and the worst case we reserve before sending one. Pure.
import { AI_MAX_TOKENS } from "./prompt";

/** Opus 5.5, $ per million tokens (standard API). Batch is half of every line. */
export const PRICE = { in: 4, out: 20, cacheWrite: 5, cacheRead: 0.2 } as const;

export interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export function costUsd(u: UsageLike, batch: boolean): number {
  const usd =
    (u.input_tokens * PRICE.in +
      (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite +
      (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead +
      u.output_tokens * PRICE.out) /
    1_000_000;
  return batch ? usd / 2 : usd;
}

const SYSTEM_TOKENS = 4_000; // instructions + format spec (~3,600), priced as a cache write
const TOKENS_PER_PAGE = 8_000; // text layer + high-res page image, generous
const BYTES_PER_PAGE = 500_000; // the scans run 60–470 KB per one-page chart

export function estimatePages(sizeBytes: number | null | undefined): number {
  return Math.min(20, Math.max(1, Math.ceil((sizeBytes ?? 0) / BYTES_PER_PAGE)));
}

/** Worst case for one request: every output token used, nothing read from cache. */
export function worstCaseUsd(sizeBytes: number | null | undefined, batch: boolean): number {
  const input = estimatePages(sizeBytes) * TOKENS_PER_PAGE + 200;
  return round6(costUsd({ input_tokens: input, output_tokens: AI_MAX_TOKENS, cache_creation_input_tokens: SYSTEM_TOKENS }, batch));
}

/** Worst case for the one retry (standard API): the first reply goes back in as input. */
export function worstCaseRetryUsd(sizeBytes: number | null | undefined): number {
  const input = estimatePages(sizeBytes) * TOKENS_PER_PAGE + 200 + AI_MAX_TOKENS + 200;
  return round6(costUsd({ input_tokens: input, output_tokens: AI_MAX_TOKENS, cache_creation_input_tokens: SYSTEM_TOKENS }, false));
}

export const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
