import { getMeta } from "./parse";
import { beatText } from "./serialize";
import {
  chordName,
  keyName,
  parseKey,
  renumberBeat,
  shiftKey,
  type Key,
} from "./transpose";
import type { BeatItem, ChartDoc, ChartMeta, NumberStyle, RowItem, Tag } from "./types";

/** Everything the song page needs to draw a chart in any key / numbering style. */
export interface BeatView {
  num: string; // "^<6->~"
  chord: string; // "^<F#m>~"
}
export type CellView =
  | { kind: "bar"; beats: BeatView[] } // 1 beat = whole bar, 2+ = split bar
  | { kind: "cue"; text: string }
  | { kind: "dynamic"; text: "<<" | ">>" }
  | { kind: "change"; text: string };
export interface SectionView {
  label: string;
  rows: CellView[][];
}
export interface ChartView {
  meta: ChartMeta;
  displayKey: string | null;
  minor: boolean;
  style: NumberStyle;
  sections: SectionView[];
}

export interface ViewOptions {
  key?: string | null; // display key; defaults to the chart's key
  style?: NumberStyle; // minor-key numbering style; defaults to the chart's
}

function decorate(b: BeatItem, core: string): string {
  if (b.kind === "repeat") return "%";
  let s = b.diamond ? `<${core}>` : core;
  if (b.push) s = "^" + s;
  if (b.end === "fermata") s += "~";
  if (b.end === "stop") s += "!";
  return s;
}

export function buildView(doc: ChartDoc, opts: ViewOptions = {}): ChartView {
  const meta = getMeta(doc);
  const original = meta.key ? parseKey(meta.key) : null;
  const requested = opts.key ? parseKey(opts.key) : null;
  const display: Key | null =
    original && requested && requested.minor === original.minor ? requested : original;
  const offset = original && display ? display.pc - original.pc : 0;
  const minor = Boolean(original?.minor);
  const style: NumberStyle = minor ? (opts.style ?? meta.numbers) : "minor";
  const from: NumberStyle = minor ? meta.numbers : "minor";

  let current = display;
  const sections: SectionView[] = [];

  const beatView = (b: BeatItem): BeatView => {
    const nb = renumberBeat(b, from, style);
    const num = beatText(nb);
    if (nb.kind === "repeat") return { num, chord: num };
    if (nb.kind === "nc" || !current) return { num, chord: decorate(nb, nb.kind === "nc" ? "N.C." : num) };
    return { num, chord: decorate(nb, chordName(nb, current, style)) };
  };

  const change = (t: Tag): CellView => {
    if (t.name === "key") {
      const k = parseKey(t.value)!;
      current = offset ? shiftKey(k, offset) : k;
      return { kind: "change", text: `Key: ${keyName(current)}` };
    }
    if (t.name === "mod") {
      const n = Number(t.value);
      if (current) current = shiftKey(current, n);
      const dir = n > 0 ? "Up" : "Down";
      const steps = Math.abs(n) === 1 ? "half step" : `${Math.abs(n)} half steps`;
      return { kind: "change", text: `${dir} ${steps}${current ? ` → ${keyName(current)}` : ""}` };
    }
    if (t.name === "bpm") return { kind: "change", text: `Tempo ${t.value}` };
    if (t.name === "time") return { kind: "change", text: `Time ${t.value}` };
    return { kind: "change", text: `Feel: ${t.value}` };
  };

  const cell = (item: RowItem): CellView => {
    switch (item.kind) {
      case "split":
        return { kind: "bar", beats: item.beats.map(beatView) };
      case "cue":
        return { kind: "cue", text: item.text };
      case "dynamic":
        return { kind: "dynamic", text: item.value === "cresc" ? "<<" : ">>" };
      case "tag":
        return change(item);
      default:
        return { kind: "bar", beats: [beatView(item)] };
    }
  };

  for (const line of doc.lines) {
    if (line.kind === "section") {
      const { name, number, repeat } = line.section;
      sections.push({
        label: `${name}${number ?? ""}${repeat ? ` x${repeat}` : ""}`,
        rows: line.rows.map((r) => r.map(cell)),
      });
    } else if (line.kind === "rows") {
      sections.at(-1)!.rows.push(...line.rows.map((r) => r.map(cell)));
    } else if (line.kind === "tags" && sections.length) {
      sections.at(-1)!.rows.push(line.tags.map(change));
    }
  }

  return { meta, displayKey: display ? keyName(display) : null, minor, style, sections };
}
