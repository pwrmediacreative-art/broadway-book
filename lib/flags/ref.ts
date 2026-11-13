import type { BeatView, ChartView } from "@/lib/chart";

/**
 * One spot on a chart: a single number/chord inside a bar.
 * Stored with each personal flag and passed to the editor for "Suggest an edit".
 * Positions are 0-based. `text` is the beat as written in the chart text, so it is the same in
 * every key, numbering style and display; it is how we notice the chart changed under a flag.
 */
export interface BarRef {
  section: number; // index into the chart's sections
  label: string; // section label without the repeat count: "C", "V2"
  bar: number; // bar within the section, counting bars only (not cues, dynamics or key changes)
  beat: number; // chord within the bar (0 for a whole-bar chord)
  text: string; // as written: "5-", "^4", "%"
}

const baseLabel = (label: string) => label.replace(/ x\d+$/, "");

/** Bars of one section in reading order. */
export function sectionBars(view: ChartView, section: number): BeatView[][] {
  const s = view.sections[section];
  if (!s) return [];
  return s.rows.flatMap((row) => row.flatMap((c) => (c.kind === "bar" ? [c.beats] : [])));
}

export function refAt(view: ChartView, section: number, bar: number, beat: number): BarRef | null {
  const b = sectionBars(view, section)[bar]?.[beat];
  if (!b) return null;
  return { section, label: baseLabel(view.sections[section].label), bar, beat, text: b.src };
}

/** True when the spot still holds the same thing it held when it was flagged. */
export function refMatches(view: ChartView | null, ref: BarRef): boolean {
  if (!view) return false;
  const now = refAt(view, ref.section, ref.bar, ref.beat);
  return !!now && now.label === ref.label && now.text === ref.text;
}

export const refKey = (r: Pick<BarRef, "section" | "bar" | "beat">) => `${r.section}.${r.bar}.${r.beat}`;

/** "C · bar 3" (+ " · chord 2" inside a split bar) for people. */
export function spotLabel(r: Pick<BarRef, "label" | "bar" | "beat">, splitBar: boolean): string {
  return `${r.label} · bar ${r.bar + 1}${splitBar ? ` · chord ${r.beat + 1}` : ""}`;
}

/** Query string for the editor: s=1&b=2&p=0 */
export const refQuery = (r: Pick<BarRef, "section" | "bar" | "beat">) => `s=${r.section}&b=${r.bar}&p=${r.beat}`;

/**
 * Where a bar sits in the chart text, as [start, end) character offsets, mirroring the parser:
 * sections start at "[...]" lines; bars are top-level tokens that are not cues, tags or dynamics;
 * a split bar "(1 4)" is one token. Returns null if the chart has no such bar.
 */
export function locateBar(text: string, section: number, bar: number): { start: number; end: number } | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let offset = 0;
  let sec = -1;
  let count = 0;
  for (const raw of lines) {
    const lineStart = offset;
    offset += raw.length + 1;
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    let from = 0;
    if (trimmed.startsWith("[")) {
      sec++;
      count = 0;
      from = raw.indexOf("]") + 1;
      if (from === 0) return null;
    } else if (sec < 0) continue; // header tags
    if (sec !== section) {
      if (sec > section) return null;
      continue;
    }
    for (const t of tokens(raw, from)) {
      const tok = raw.slice(t.start, t.end);
      if (tok.startsWith('"') || tok.startsWith("{") || tok === "<<" || tok === ">>") continue;
      if (count === bar) return { start: lineStart + t.start, end: lineStart + t.end };
      count++;
    }
  }
  return null;
}

/** Top-level tokens of one line (split on spaces and "|" outside quotes, braces and parens). */
function tokens(line: string, from: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let start = -1;
  let quote = false;
  let depth = 0;
  for (let i = from; i <= line.length; i++) {
    const ch = line[i] ?? " ";
    const sep = !quote && depth === 0 && (/\s/.test(ch) || ch === "|");
    if (sep) {
      if (start >= 0) out.push({ start, end: i });
      start = -1;
      continue;
    }
    if (start < 0) start = i;
    if (ch === '"') quote = !quote;
    else if (!quote && (ch === "{" || ch === "(")) depth++;
    else if (!quote && (ch === "}" || ch === ")")) depth--;
  }
  return out;
}
