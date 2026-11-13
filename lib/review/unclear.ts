// "# UNCLEAR: <where>: <what was seen>" notes left in imported charts. Pure.
import type { ChartDoc } from "@/lib/chart";
// The database counts the same lines (public.unclear_count) to block verified publishing.

export interface UnclearNote {
  line: number; // 0-based line in the chart text
  where: string; // "C bar 9-11"
  saw: string; // what the reader saw
  start: number; // character offset of the line, for selecting it in a textarea
  end: number;
}

const NOTE = /^# UNCLEAR\b:?\s*(.*)$/;

export function unclearNotes(text: string): UnclearNote[] {
  const out: UnclearNote[] = [];
  let offset = 0;
  text.split("\n").forEach((raw, line) => {
    const m = NOTE.exec(raw);
    if (m) {
      const body = m[1].trim();
      const i = body.indexOf(": ");
      out.push({
        line,
        where: i > 0 ? body.slice(0, i) : "",
        saw: i > 0 ? body.slice(i + 2) : body,
        start: offset,
        end: offset + raw.length,
      });
    }
    offset += raw.length + 1;
  });
  return out;
}

export const FLAG_REASONS = {
  wrong_chords: "Wrong chords or numbers",
  wrong_structure: "Wrong sections or order",
  wrong_key: "Wrong key or tempo",
  lyrics: "Has lyrics",
  other: "Something else",
} as const;
export type FlagReason = keyof typeof FLAG_REASONS;

/**
 * Which preview rows each chart text line draws, as "section-row" keys (indexes into
 * buildView(doc).sections[s].rows[r]). Mirrors buildView: a {tags} line between sections
 * joins the next section if a label follows, otherwise the current one. Pure.
 */
export function lineRows(doc: ChartDoc): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const counts: number[] = [];
  let pending: number[] = []; // line indexes of {tags} lines waiting for a home
  const put = (line: number, s: number) => {
    const key = `${s}-${counts[s]++}`;
    out.set(line, [...(out.get(line) ?? []), key]);
  };
  const flush = () => {
    if (counts.length) pending.forEach((l) => put(l, counts.length - 1));
    pending = [];
  };
  doc.lines.forEach((line, i) => {
    if (line.kind === "section") {
      counts.push(0);
      const s = counts.length - 1;
      pending.forEach((l) => put(l, s));
      pending = [];
      line.rows.forEach(() => put(i, s));
    } else if (line.kind === "rows") {
      flush();
      if (counts.length) line.rows.forEach(() => put(i, counts.length - 1));
    } else if (line.kind === "tags" && counts.length) {
      pending.push(i);
    }
  });
  flush();
  return out;
}

export interface UnclearMark {
  note: UnclearNote;
  target: number | null; // the chart line the note is about (the next non-comment line)
  rows: string[]; // preview rows of that line ("section-row")
}

/** Each unclear note with the chart line under it and that line's preview rows. */
export function unclearMarks(text: string, doc: ChartDoc | null): UnclearMark[] {
  const lines = text.split("\n");
  const rows = doc ? lineRows(doc) : new Map<number, string[]>();
  return unclearNotes(text).map((note) => {
    let t = note.line + 1;
    while (t < lines.length && lines[t].trim().startsWith("#")) t++;
    const target = t < lines.length && lines[t].trim() !== "" ? t : null;
    return { note, target, rows: target == null ? [] : (rows.get(target) ?? []) };
  });
}
