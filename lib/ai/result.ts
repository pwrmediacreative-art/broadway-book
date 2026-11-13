// Turn one model reply into an outcome, and an outcome into the row ai_finish() stores.
// Pure: takes plain reply data, so it's testable without the SDK.
import { checkChart, MAX_CUE_WORDS } from "../chart/validate";
import type { Reading } from "./prompt";

export interface ReplyLike {
  stop_reason: string | null;
  stop_details?: { category?: string | null } | null;
  content: { type: string; text?: string }[];
}

export type Outcome =
  | { kind: "ok"; reading: Reading; canonical: string; warnings: string[] }
  | { kind: "parse_error"; reading: Reading; error: string } // worth one retry
  | { kind: "refused"; error: string }
  | { kind: "error"; error: string };

export function interpret(reply: ReplyLike): Outcome {
  if (reply.stop_reason === "refusal") {
    return { kind: "refused", error: `Refused (${reply.stop_details?.category ?? "no reason given"})` };
  }
  if (reply.stop_reason === "max_tokens") return { kind: "error", error: "Reply was cut off (max_tokens)." };
  const text = reply.content.find((b) => b.type === "text")?.text;
  if (!text) return { kind: "error", error: "No text in the reply." };
  let reading: Reading;
  try {
    reading = normalize(JSON.parse(text));
  } catch {
    return { kind: "error", error: "Reply wasn't valid JSON." };
  }
  const check = checkChart(reading.chart_text);
  if (check.error) return { kind: "parse_error", reading, error: check.error };
  if (check.longCues.length) {
    // Long cues are how lyrics sneak in. Ask once for short cues instead.
    return {
      kind: "parse_error",
      reading,
      error: `Cue over ${MAX_CUE_WORDS} words (possible lyrics, not allowed): "${check.longCues[0]}"`,
    };
  }
  return { kind: "ok", reading, canonical: check.canonical!, warnings: check.warnings };
}

function normalize(x: unknown): Reading {
  const r = (x ?? {}) as Partial<Reading>;
  if (typeof r.chart_text !== "string") throw new Error("no chart_text");
  const conf = Number(r.confidence);
  return {
    chart_text: r.chart_text,
    confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, Math.round(conf * 100) / 100)) : 0,
    unclear: Array.isArray(r.unclear)
      ? r.unclear.slice(0, 200).map((u) => ({
          section: String(u?.section ?? "").slice(0, 60),
          bar: String(u?.bar ?? "").slice(0, 20),
          saw: String(u?.saw ?? "").slice(0, 200),
        }))
      : [],
    handwriting: r.handwriting ?? "mixed",
    image_type: r.image_type ?? "scan",
    pages: Number.isInteger(r.pages) ? r.pages! : 1,
    has_lyrics: Boolean(r.has_lyrics),
    notes: String(r.notes ?? "").slice(0, 500),
  };
}

export type FinishStatus = "ok" | "ok_after_retry" | "needs_manual" | "refused" | "error";

export interface Tokens {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}
export const noTokens = (): Tokens => ({ input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 });

/**
 * Final status for a billed reply: a parse error after the retry means a human types it.
 * So does a billed reply with no chart at all (cut off at max tokens, not valid JSON):
 * a re-send would likely fail the same way at full price, so there's no automatic retry.
 */
export function finishStatus(o: Outcome, retried: boolean): FinishStatus {
  if (o.kind === "ok") return retried ? "ok_after_retry" : "ok";
  if (o.kind === "parse_error" || o.kind === "error") return "needs_manual";
  return o.kind;
}

/** The p_result jsonb for ai_finish(). The raw reading always rides along. */
export function finishPayload(o: Outcome, costUsd: number, tokens: Tokens) {
  const reading = o.kind === "ok" || o.kind === "parse_error" ? o.reading : null;
  return {
    ...tokens,
    cost_usd: costUsd,
    confidence: reading?.confidence ?? null,
    unclear: reading?.unclear ?? null,
    chart_text: o.kind === "ok" ? o.canonical : null,
    raw: reading,
    error: o.kind === "ok" ? (o.warnings.length ? o.warnings.join("; ").slice(0, 500) : null) : o.error,
  };
}
