import { describe, expect, it } from "vitest";
import { costUsd, estimatePages, worstCaseRetryUsd, worstCaseUsd } from "./cost";
import { pickVaried, takeChunk } from "./pick";
import { AI_MAX_TOKENS, READING_SCHEMA, retryText, systemPrompt, userText } from "./prompt";
import { finishPayload, finishStatus, interpret, noTokens, type ReplyLike } from "./result";

const GOOD = "{title: Test Song}\n{artist: Some Band}\n{key: G}\n[V] 1 4 5 1\n# UNCLEAR: C bar 2: 4 or 2-\n[C] 4 4 1 5\n";

function reply(obj: unknown, stop = "end_turn"): ReplyLike {
  return { stop_reason: stop, content: [{ type: "thinking" }, { type: "text", text: JSON.stringify(obj) }] };
}
const reading = (chart_text: string, extra: object = {}) => ({
  chart_text,
  confidence: 0.83,
  unclear: [{ section: "C", bar: "2", saw: "4 or 2-" }],
  handwriting: "mixed",
  image_type: "scan",
  pages: 1,
  has_lyrics: false,
  notes: "",
  ...extra,
});

describe("cost", () => {
  it("prices Opus 5.5 usage, batch at half", () => {
    const u = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 };
    expect(costUsd(u, false)).toBeCloseTo(4 + 20 + 5 + 0.2);
    expect(costUsd(u, true)).toBeCloseTo((4 + 20 + 5 + 0.2) / 2);
  });
  it("matches the bake-off's measured Opus medium reading (~$0.055)", () => {
    // A real bake-off reply: 1,648 in, 1,657 out, 3,560 cache write.
    const c = costUsd({ input_tokens: 1648, output_tokens: 1657, cache_creation_input_tokens: 3560 }, false);
    expect(c).toBeCloseTo(0.057532, 5);
  });
  it("reserves a worst case well above a real reading", () => {
    expect(estimatePages(300_000)).toBe(1);
    expect(estimatePages(1_200_000)).toBe(3);
    expect(estimatePages(null)).toBe(1);
    expect(estimatePages(1e12)).toBe(20);
    const batch = worstCaseUsd(300_000, true);
    expect(batch).toBeCloseTo(worstCaseUsd(300_000, false) / 2, 5);
    expect(batch).toBeGreaterThan((0.0575 / 2) * 3); // > 3× a typical batch reading
    expect(batch).toBeLessThan(0.2); // but not so high the $90 cap stalls the run
    expect(worstCaseRetryUsd(300_000)).toBeGreaterThan(worstCaseUsd(300_000, false));
    // Output can't exceed AI_MAX_TOKENS, so the worst case covers it.
    expect(worstCaseUsd(0, false)).toBeGreaterThanOrEqual((AI_MAX_TOKENS * 20) / 1e6);
  });
});

describe("pickVaried", () => {
  const all = Array.from({ length: 300 }, (_, i) => ({
    id: String(i),
    file_name: `${"abcdefghijklmnopqrstuvwxyz"[i % 26]}${i} - Artist.pdf`,
    size: 50_000 + i * 1_500,
  }));
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  it("picks n distinct files spread across sizes and letters", () => {
    const p = pickVaried(all, 20, rand);
    expect(p).toHaveLength(20);
    expect(new Set(p.map((x) => x.id)).size).toBe(20);
    const sizes = p.map((x) => x.size).sort((a, b) => a - b);
    expect(sizes[0]).toBeLessThan(50_000 + 15 * 1_500); // one from the smallest bucket
    expect(sizes[19]).toBeGreaterThan(50_000 + 285 * 1_500); // one from the largest
    expect(new Set(p.map((x) => x.file_name[0])).size).toBe(20);
  });
  it("returns everything when there are fewer than n", () => {
    expect(pickVaried(all.slice(0, 5), 20)).toHaveLength(5);
  });
});

describe("prompt", () => {
  it("embeds the spec, the no-lyrics rule and flagged best guesses", () => {
    const s = systemPrompt("SPEC-TEXT");
    expect(s).toContain("SPEC-TEXT");
    expect(s).toContain("NEVER write lyrics");
    expect(s).toContain("# UNCLEAR:");
    expect(s).toContain("NEVER invent");
  });
  it("gives a filename hint", () => {
    expect(userText("Any Man Of Mine - Shania Twain.pdf")).toContain('artist "Shania Twain"');
  });
  it("asks for the fields we store", () => {
    expect(READING_SCHEMA.required).toEqual(expect.arrayContaining(["chart_text", "confidence", "unclear", "has_lyrics"]));
    expect(retryText("Line 3: bad")).toContain("Line 3: bad");
  });
});

describe("interpret", () => {
  it("accepts a chart that parses and keeps UNCLEAR comments in the canonical text", () => {
    const o = interpret(reply(reading(GOOD)));
    expect(o.kind).toBe("ok");
    if (o.kind !== "ok") return;
    expect(o.canonical).toContain("# UNCLEAR: C bar 2");
    expect(o.reading.confidence).toBe(0.83);
    expect(finishStatus(o, false)).toBe("ok");
    expect(finishStatus(o, true)).toBe("ok_after_retry");
    const p = finishPayload(o, 0.03, noTokens());
    expect(p.chart_text).toBe(o.canonical);
    expect(p.raw?.chart_text).toBe(GOOD);
    expect(p.error).toBeNull();
  });
  it("turns a parser error into a retryable outcome, then needs_manual", () => {
    const o = interpret(reply(reading("[V] 1 4 5 1\n[Zzz] 1\n")));
    expect(o.kind).toBe("parse_error");
    if (o.kind !== "parse_error") return;
    expect(o.error).toMatch(/Line \d/);
    expect(finishStatus(o, true)).toBe("needs_manual");
    const p = finishPayload(o, 0.05, noTokens());
    expect(p.chart_text).toBeNull(); // never saved as a revision
    expect(p.raw?.chart_text).toContain("[Zzz]");
  });
  it("treats a long cue as possible lyrics and asks again", () => {
    const o = interpret(reply(reading('{title: T}\n{key: C}\n[V] 1 "and I will always love you baby" 4\n')));
    expect(o.kind).toBe("parse_error");
    if (o.kind === "parse_error") expect(o.error).toContain("possible lyrics");
  });
  it("clamps confidence and tidies the reading", () => {
    const o = interpret(reply(reading(GOOD, { confidence: 7, unclear: "nope" })));
    expect(o.kind).toBe("ok");
    if (o.kind === "ok") {
      expect(o.reading.confidence).toBe(1);
      expect(o.reading.unclear).toEqual([]);
    }
  });
  it("reports refusals, cut-offs and junk without saving a chart", () => {
    expect(interpret({ stop_reason: "refusal", stop_details: { category: "cyber" }, content: [] })).toEqual({
      kind: "refused",
      error: "Refused (cyber)",
    });
    expect(interpret(reply(reading(GOOD), "max_tokens")).kind).toBe("error");
    expect(interpret({ stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] }).kind).toBe("error");
    expect(interpret({ stop_reason: "end_turn", content: [] }).kind).toBe("error");
    // Billed but no chart: a person types it; no automatic retry.
    expect(finishStatus(interpret(reply(reading(GOOD), "max_tokens")), false)).toBe("needs_manual");
    expect(finishStatus({ kind: "refused", error: "x" }, false)).toBe("refused");
    const p = finishPayload({ kind: "refused", error: "Refused (x)" }, 0.01, noTokens());
    expect(p.chart_text).toBeNull();
    expect(p.raw).toBeNull();
  });
});

describe("takeChunk", () => {
  const c = (id: string, size: number) => ({ id, file_name: id, size });
  it("stops at the file count", () => {
    const all = Array.from({ length: 40 }, (_, i) => c(`f${i}`, 1000));
    expect(takeChunk(all, 25, 100e6).map((x) => x.id)).toEqual(all.slice(0, 25).map((x) => x.id));
  });
  it("stops before going over the byte limit, keeping order", () => {
    const all = [c("a", 40e6), c("b", 40e6), c("c", 40e6), c("d", 1)];
    expect(takeChunk(all, 25, 100e6).map((x) => x.id)).toEqual(["a", "b"]);
  });
  it("always takes at least one file, even a huge one", () => {
    expect(takeChunk([c("big", 300e6), c("b", 1)], 25, 100e6).map((x) => x.id)).toEqual(["big"]);
    expect(takeChunk([], 25, 100e6)).toEqual([]);
  });
});
