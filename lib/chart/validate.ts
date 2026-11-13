// Checks a chart before it is saved (personal version or suggestion). Used live in the
// editor and again on the server before writing. The database repeats the long-cue check.
import { parseChart } from "./parse";
import { serializeChart } from "./serialize";
import type { ChartDoc } from "./types";

export const MAX_CUE_WORDS = 6;

export interface ChartCheck {
  ok: boolean; // parses and has no long cues
  error: string | null; // parse error
  warnings: string[]; // non-blocking (missing title/key, …)
  longCues: string[]; // blocking: cues over MAX_CUE_WORDS words (lyrics guard)
  doc: ChartDoc | null;
  canonical: string | null; // the text we store
}

export function normalizeChartText(text: string): string {
  const t = text.replace(/\r\n?/g, "\n");
  return t.endsWith("\n") ? t : t + "\n";
}

export function checkChart(text: string): ChartCheck {
  const src = normalizeChartText(text);
  if (!src.trim()) return { ok: false, error: "The chart is empty.", warnings: [], longCues: [], doc: null, canonical: null };
  try {
    const { doc, warnings } = parseChart(src);
    const longCues: string[] = [];
    for (const line of doc.lines) {
      if (line.kind !== "section" && line.kind !== "rows") continue;
      for (const row of line.rows)
        for (const item of row)
          if (item.kind === "cue" && item.text.split(/\s+/).length > MAX_CUE_WORDS) longCues.push(item.text);
    }
    return {
      ok: longCues.length === 0,
      error: null,
      warnings: warnings.filter((w) => !w.includes("is long")),
      longCues,
      doc,
      canonical: serializeChart(doc),
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message, warnings: [], longCues: [], doc: null, canonical: null };
  }
}
