// Where each lyric line sits under the chart (Q18). Pure: no network, no storage.
//
// A "bar row" is one drawn line of bars (lib/chart/layout layoutRow, 4 bars a line). It is
// named by its section's label (hashed: "C", "V2"), which section with that label it is (the
// 2nd "C" = 1) and which bar row inside that section, so a player's placement survives edits
// elsewhere in the chart. Only these numbers and the line number are ever saved, never text.
import { beatsPerBar, layoutRow, type ChartView } from "../chart";
import { MAX_LINES, type LyricLine } from "./match";

export interface RowRef {
  h: number; // labelHash of the section label, repeat count removed
  n: number; // which section with that label (0 = first)
  r: number; // bar row inside that section (0 = first)
}
export interface BarRow {
  key: string; // "section.row" (rowKey), what Chart draws lyrics under
  section: number;
  ref: RowRef;
  bars: number;
}
export interface Placed {
  line: number; // the line's number in the lyrics
  text: string;
  moved: boolean; // the player put it here ("Adjust lyrics")
}

// Upper bounds the database checks too (lyrics_song_prefs.placements).
export const MAX_NTH = 49;
export const MAX_ROW = 199;

export const rowKey = (section: number, row: number) => `${section}.${row}`;
const baseLabel = (label: string) => label.replace(/ x\d+$/, "");

/** 32-bit FNV-1a of a section label, as a signed integer (what the database stores). */
export function labelHash(label: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

/** Every bar row of the chart in reading order. */
export function barRows(view: ChartView): BarRow[] {
  const seen = new Map<number, number>();
  const out: BarRow[] = [];
  view.sections.forEach((s, i) => {
    const h = labelHash(baseLabel(s.label));
    const n = seen.get(h) ?? 0;
    seen.set(h, n + 1);
    let r = 0;
    for (const row of s.rows) {
      for (const line of layoutRow(row)) {
        if (!line.bars.length) continue;
        out.push({ key: rowKey(i, r), section: i, ref: { h, n, r }, bars: line.bars.length });
        r++;
      }
    }
  });
  return out;
}

export const sameRef = (a: RowRef, b: RowRef) => a.h === b.h && a.n === b.n && a.r === b.r;
export const findRow = (rows: BarRow[], ref: RowRef) => rows.findIndex((x) => sameRef(x.ref, ref));

/**
 * The bar row each line goes under when the player hasn't moved it (index into barRows, -1 when
 * the chart has no bars). Rows are walked in play order, a section once per pass ([C x2] twice).
 * Synced lyrics + the chart's BPM and time signature: a line's time picks its bar (when the
 * lyrics run past the chart as written, the times are squeezed to fit). Plain lyrics, or no
 * BPM: lines are spread evenly over the rows.
 */
export function autoPlace(view: ChartView, lines: LyricLine[], rows: BarRow[] = barRows(view)): number[] {
  if (!rows.length) return lines.map(() => -1);
  const order: number[] = [];
  view.sections.forEach((s, i) => {
    const own = rows.flatMap((x, k) => (x.section === i ? [k] : []));
    for (let p = 0; p < Math.max(1, s.repeat); p++) order.push(...own);
  });
  const bpm = view.meta.bpm;
  if (bpm && lines.some((l) => l.t !== null)) {
    const barSec = (beatsPerBar(view.meta.time) * 60) / bpm;
    const starts: number[] = [];
    let total = 0;
    for (const k of order) {
      starts.push(total);
      total += rows[k].bars;
    }
    let last = 0;
    const at = lines.map((l) => (l.t !== null ? (last = Math.max(0, l.t) / barSec) : last));
    const end = Math.max(0, ...at);
    const squeeze = end >= total ? total / (end + 1) : 1;
    return at.map((b) => {
      const bar = b * squeeze;
      let k = 0;
      while (k + 1 < starts.length && starts[k + 1] <= bar) k++;
      return order[k];
    });
  }
  return lines.map((_, i) => order[Math.min(order.length - 1, Math.floor((i * order.length) / lines.length))]);
}

/**
 * Lines grouped under their bar rows (by rowKey), in line order, so a [C x2] row shows its
 * first-pass line, then its second. A moved line stays where the player put it while that bar
 * row still exists; when an edit removed the row, it goes back to its automatic place.
 */
export function placeLines(view: ChartView, lines: LyricLine[], moved: ReadonlyMap<number, RowRef>): Map<string, Placed[]> {
  const rows = barRows(view);
  const auto = autoPlace(view, lines, rows);
  const out = new Map<string, Placed[]>();
  lines.forEach((l, i) => {
    const m = moved.get(i);
    const at = m ? findRow(rows, m) : -1;
    const k = at >= 0 ? at : auto[i];
    if (k < 0) return;
    const list = out.get(rows[k].key) ?? [];
    list.push({ line: i, text: l.text, moved: at >= 0 });
    out.set(rows[k].key, list);
  });
  for (const list of out.values()) list.sort((a, b) => a.line - b.line);
  return out;
}

/** The bar row `d` rows up (-1) or down (+1) from rowKey `key`, or null at either end. */
export function stepRow(rows: BarRow[], key: string, d: -1 | 1): BarRow | null {
  const i = rows.findIndex((x) => x.key === key);
  return i < 0 ? null : (rows[i + d] ?? null);
}

/** Saved form: a flat list of integers, 4 per moved line: line, label hash, nth, bar row. */
export function encodePlacements(moved: ReadonlyMap<number, RowRef>): number[] {
  return [...moved.entries()]
    .filter(([line, r]) => line >= 0 && line < MAX_LINES && r.n >= 0 && r.n <= MAX_NTH && r.r >= 0 && r.r <= MAX_ROW)
    .sort((a, b) => a[0] - b[0])
    .flatMap(([line, r]) => [line, r.h | 0, r.n, r.r]);
}

export function decodePlacements(flat: readonly number[] | null | undefined): Map<number, RowRef> {
  const out = new Map<number, RowRef>();
  if (!Array.isArray(flat)) return out;
  for (let i = 0; i + 3 < flat.length; i += 4) {
    const [line, h, n, r] = flat.slice(i, i + 4);
    if ([line, h, n, r].every(Number.isInteger)) out.set(line, { h, n, r });
  }
  return out;
}
