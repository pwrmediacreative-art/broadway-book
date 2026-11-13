import type { BeatParts, CellView, ChartView } from "./view";

/** Bars per grid line. Every line uses the same 4 columns so bars line up down the page. */
export const COLS = 4;

export type BarCell = Extract<CellView, { kind: "bar" }>;
export interface Note {
  kind: "cue" | "change" | "dynamic";
  text: string;
}
/** Notes (cues, key/feel changes) drawn above the bar they come before. */
export interface GridNotes {
  notes: Note[];
  col: number; // 0-based start column
  span: number;
}
/** A crescendo/decrescendo wedge under bars. from/to = how far along the whole wedge (0..1). */
export interface Hairpin {
  dir: "cresc" | "decresc";
  col: number;
  span: number;
  from: number;
  to: number;
}
export interface GridLine {
  bars: { cell: BarCell; col: number }[];
  above: GridNotes[];
  after: GridNotes | null; // notes after the last bar
  afterBelow: boolean; // no room left on the line: draw them underneath
  hairpins: Hairpin[];
}

/** Split one chart row into grid lines of COLS bars, attaching notes and dynamics to bars. */
export function layoutRow(row: CellView[], cols = COLS): GridLine[] {
  const bars: BarCell[] = [];
  const before = new Map<number, Note[]>();
  const dyns: { dir: Hairpin["dir"]; start: number; end: number }[] = [];
  let pending: Note[] = [];
  let pendingDyn: Hairpin["dir"] | null = null;

  for (const c of row) {
    if (c.kind === "bar") {
      const i = bars.length;
      if (pending.length) before.set(i, pending);
      pending = [];
      if (pendingDyn) {
        const open = dyns.at(-1);
        if (open && open.end === -1) open.end = i - 1;
        dyns.push({ dir: pendingDyn, start: i, end: -1 });
        pendingDyn = null;
      }
      bars.push(c);
    } else if (c.kind === "dynamic") {
      pendingDyn = c.text === "<<" ? "cresc" : "decresc";
    } else {
      pending.push({ kind: c.kind, text: c.text });
    }
  }
  const open = dyns.at(-1);
  if (open && open.end === -1) open.end = bars.length - 1;
  if (pendingDyn) pending.push({ kind: "dynamic", text: pendingDyn === "cresc" ? "cresc." : "decresc." });

  if (!bars.length) {
    return [{ bars: [], above: [], after: { notes: pending, col: 0, span: cols }, afterBelow: false, hairpins: [] }];
  }

  const lines: GridLine[] = [];
  for (let k0 = 0; k0 < bars.length; k0 += cols) {
    const k1 = Math.min(k0 + cols, bars.length) - 1;
    const line: GridLine = { bars: [], above: [], after: null, afterBelow: false, hairpins: [] };
    for (let k = k0; k <= k1; k++) line.bars.push({ cell: bars[k], col: k - k0 });

    const starts = [...before.keys()].filter((k) => k >= k0 && k <= k1).sort((a, b) => a - b);
    starts.forEach((k, idx) => {
      const col = k - k0;
      const next = idx + 1 < starts.length ? starts[idx + 1] - k0 : cols;
      line.above.push({ notes: before.get(k)!, col, span: next - col });
    });

    for (const d of dyns) {
      const a = Math.max(d.start, k0);
      const b = Math.min(d.end, k1);
      if (a > b) continue;
      const n = d.end - d.start + 1;
      line.hairpins.push({ dir: d.dir, col: a - k0, span: b - a + 1, from: (a - d.start) / n, to: (b - d.start + 1) / n });
    }

    if (k1 === bars.length - 1 && pending.length) {
      const col = k1 - k0 + 1;
      line.after = col < cols ? { notes: pending, col, span: cols - col } : { notes: pending, col: 0, span: cols };
      line.afterBelow = col >= cols;
    }
    lines.push(line);
  }
  return lines;
}

const SUP_SPLIT = /^(-|m(?!aj))?(.*)$/;
/** Quality split into the part written inline (minor "-" / "m") and the superscript rest. */
export function splitQuality(q: string): [string, string] {
  const m = SUP_SPLIT.exec(q)!;
  return [m[1] ?? "", m[2] ?? ""];
}

/** b and # as real flat/sharp signs: b7 -> ♭7, Bb -> B♭, F# -> F♯, m7b5 -> m7♭5. */
export function pretty(s: string): string {
  return s.replace(/([A-G])b/g, "$1♭").replace(/b(?=\d)/g, "♭").replace(/#/g, "♯");
}

/** Rough width of a bar in character units, used to shrink long bars so they never overflow. */
export function barUnits(cell: BarCell, chords: boolean): number {
  let u = 0;
  for (const b of cell.beats) {
    const p: BeatParts = chords ? b.c : b.n;
    const [inline, sup] = splitQuality(p.qual);
    u += p.root.length + inline.length + 0.6 * sup.length + 0.3;
    if (p.bass) u += 0.8 * (1 + p.bass.length);
    if (b.diamond) u += 1.1;
  }
  if (cell.beats.length > 1) u += 0.5;
  return u;
}

export const BAR_CAP = 3.6;
export function barScale(cell: BarCell, chords: boolean): number {
  return Math.max(0.5, Math.min(1, BAR_CAP / barUnits(cell, chords)));
}

/** Auto-scroll speeds, in em (chart text heights) per second. 12 steps, very slow to fast. */
export const SPEEDS = [0.05, 0.08, 0.11, 0.15, 0.2, 0.26, 0.33, 0.42, 0.53, 0.66, 0.82, 1.0];
/** Fastest speed level players can pick (1-based into SPEEDS). Change this one number to raise or lower the cap. */
export const MAX_SPEED = 6;
/** Largest stage-mode text size in px, for auto-fit, the size slider and saved sizes. */
export const MAX_STAGE_SIZE = 75;
/** A saved stage size: null when unset or junk, else capped at MAX_STAGE_SIZE. */
export function clampStageSize(saved: number | null): number | null {
  if (saved === null || !Number.isFinite(saved) || saved <= 0) return null;
  return Math.min(MAX_STAGE_SIZE, saved);
}
/** Any stored or suggested speed, clamped to 1..MAX_SPEED. */
export const clampSpeed = (n: number) => Math.min(MAX_SPEED, Math.max(1, Math.round(n)));

/** Beats per bar for timing: 4/4 -> 4, 3/4 -> 3, 6/8 and 12/8 -> 2 and 4 (felt in dotted quarters). */
export function beatsPerBar(time: string | null): number {
  const m = /^(\d+)\/(\d+)$/.exec(time ?? "");
  if (!m) return 4;
  const [n, d] = [Number(m[1]), Number(m[2])];
  return d === 8 && n % 3 === 0 ? n / 3 : n;
}

/** Bars played once through the chart as written (section repeats counted). */
export function playedBars(view: ChartView): number {
  let bars = 0;
  for (const s of view.sections) {
    let n = 0;
    for (const r of s.rows) n += r.filter((c) => c.kind === "bar").length;
    bars += n * s.repeat;
  }
  return bars;
}

/**
 * Suggested scroll step (1-12) so the chart scrolls past in about the time it takes to play
 * through once at the chart's BPM. Only a starting point; never forced.
 */
export function suggestSpeed(view: ChartView, distancePx: number, fontPx: number): number | null {
  const bpm = view.meta.bpm;
  const bars = playedBars(view);
  if (!bpm || !bars || distancePx <= 0 || fontPx <= 0) return null;
  const seconds = (bars * beatsPerBar(view.meta.time) * 60) / bpm;
  const emPerSec = distancePx / fontPx / seconds;
  let best = 0;
  for (let i = 1; i < Math.min(MAX_SPEED, SPEEDS.length); i++) {
    if (Math.abs(SPEEDS[i] - emPerSec) < Math.abs(SPEEDS[best] - emPerSec)) best = i;
  }
  return best + 1;
}
