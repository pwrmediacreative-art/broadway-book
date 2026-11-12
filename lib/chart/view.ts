import { getMeta } from "./parse";
import { beatText } from "./serialize";
import {
  chordName,
  degreeToNote,
  keyName,
  keyPairLabel,
  keyPairShort,
  numberingKey,
  qualityName,
  parseKey,
  renumberBeat,
  shiftKey,
  type Key,
} from "./transpose";
import type { BeatItem, ChartDoc, Degree, ChartMeta, NumberStyle, RowItem, Tag } from "./types";

/** Everything the song page needs to draw a chart in any key / numbering style. */
/** A chord split for drawing: root, quality (superscript part), slash bass. No modifiers. */
export interface BeatParts {
  root: string; // "6", "b7", "F#", "N.C.", "%"
  qual: string; // "-7", "m7", "sus4"
  bass: string; // "3", "C#", ""
}
export interface BeatView {
  num: string; // "^<6->~"  (text form, numbers)
  chord: string; // "^<F#m>~" (text form, chord names)
  kind: "chord" | "nc" | "repeat";
  push: boolean;
  diamond: boolean;
  end: "" | "fermata" | "stop";
  n: BeatParts; // numbers, without modifiers
  c: BeatParts; // chord names, without modifiers
}
export type CellView =
  | { kind: "bar"; beats: BeatView[] } // 1 beat = whole bar, 2+ = split bar
  | { kind: "cue"; text: string }
  | { kind: "dynamic"; text: "<<" | ">>" }
  | { kind: "change"; text: string };
export interface SectionView {
  label: string;
  repeat: number; // [C x2] -> 2
  rows: CellView[][];
}
export interface ChartView {
  meta: ChartMeta;
  displayKey: string | null; // the song's key as played ("Am"), what the key picker stores
  numberKey: string | null; // the key the numbers count from: "C" for Am numbered relative
  keyLabel: string | null; // "A minor (relative to C major)" / "C major (relative to A minor)" / "E major"
  keyShort: string | null; // "Am (C)" / "C (Am)" / "E"
  minor: boolean;
  style: NumberStyle;
  sections: SectionView[];
}

export interface ViewOptions {
  key?: string | null; // display key; defaults to the chart's key
  style?: NumberStyle; // minor-key numbering style; defaults to the chart's
  minorSymbol?: MinorSymbol; // how minor numbers are drawn; display only, default "-"
}

/** How minor chords show in Numbers view: "6-" or "6m". The stored chart text always uses "-". */
export type MinorSymbol = "-" | "m";

const minorQual = (q: string, sym: MinorSymbol) => (sym === "m" && q.startsWith("-") ? "m" + q.slice(1) : q);

const degText = (d: Degree) => `${d.acc}${d.degree}`;

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
  const sym: MinorSymbol = opts.minorSymbol ?? "-";

  let current = display;
  const sections: SectionView[] = [];

  const beatView = (b: BeatItem): BeatView => {
    const nb = renumberBeat(b, from, style);
    const num = beatText(nb.kind === "chord" ? { ...nb, quality: minorQual(nb.quality, sym) } : nb);
    if (nb.kind === "repeat") {
      const p = { root: "%", qual: "", bass: "" };
      return { num, chord: num, kind: "repeat", push: false, diamond: false, end: "", n: p, c: p };
    }
    const mods = { push: nb.push, diamond: nb.diamond, end: nb.end };
    if (nb.kind === "nc") {
      const p = { root: "N.C.", qual: "", bass: "" };
      return { num, chord: decorate(nb, "N.C."), kind: "nc", ...mods, n: p, c: p };
    }
    const n = { root: degText(nb.root), qual: minorQual(nb.quality, sym), bass: nb.bass ? degText(nb.bass) : "" };
    if (!current) return { num, chord: decorate(nb, num), kind: "chord", ...mods, n, c: n };
    const c = {
      root: degreeToNote(nb.root, current, style),
      qual: qualityName(nb.quality),
      bass: nb.bass ? degreeToNote(nb.bass, current, style) : "",
    };
    return { num, chord: decorate(nb, chordName(nb, current, style)), kind: "chord", ...mods, n, c };
  };

  const change = (t: Tag): CellView => {
    if (t.name === "key") {
      const k = parseKey(t.value)!;
      current = offset ? shiftKey(k, offset) : k;
      return { kind: "change", text: `Key: ${keyPairShort(current, style)}` };
    }
    if (t.name === "mod") {
      const n = Number(t.value);
      if (current) current = shiftKey(current, n);
      const dir = n > 0 ? "Up" : "Down";
      const steps = Math.abs(n) === 1 ? "half step" : `${Math.abs(n)} half steps`;
      return { kind: "change", text: `${dir} ${steps}${current ? ` → ${keyPairShort(current, style)}` : ""}` };
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

  // A tags line standing right before a section label ({mod: +1}) belongs to that section.
  let pending: CellView[][] = [];
  const flush = () => {
    if (pending.length && sections.length) sections.at(-1)!.rows.push(...pending);
    pending = [];
  };
  for (const line of doc.lines) {
    if (line.kind === "section") {
      const { name, number, repeat } = line.section;
      sections.push({
        label: `${name}${number ?? ""}${repeat ? ` x${repeat}` : ""}`,
        repeat: repeat ?? 1,
        rows: [...pending, ...line.rows.map((r) => r.map(cell))],
      });
      pending = [];
    } else if (line.kind === "rows") {
      flush();
      sections.at(-1)!.rows.push(...line.rows.map((r) => r.map(cell)));
    } else if (line.kind === "tags" && sections.length) {
      pending.push(line.tags.map(change));
    }
  }
  flush();

  return {
    meta,
    displayKey: display ? keyName(display) : null,
    numberKey: display ? keyName(numberingKey(display, style)) : null,
    keyLabel: display ? keyPairLabel(display, style) : null,
    keyShort: display ? keyPairShort(display, style) : null,
    minor,
    style,
    sections,
  };
}
