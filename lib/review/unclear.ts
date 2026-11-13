// "# UNCLEAR: <where>: <what was seen>" notes left in imported charts. Pure.
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
