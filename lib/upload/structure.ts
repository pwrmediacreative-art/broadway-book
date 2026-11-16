// The "Structure" cheat sheet for a fill-in player, read from (and written back to) the
// chart text, so the chart stays the one source of truth. Form = the sections in order with
// bar counts and repeats; start / ending / watch-outs come from cue words and symbols.
import { parseChart } from "../chart/parse";
import { serializeChart } from "../chart/serialize";
import { MAX_CUE_WORDS } from "../chart/validate";
import { SECTION_NAMES, type ChartDoc, type Line, type Row, type RowItem, type SectionName } from "../chart/types";

export const START_CUES = ["count off", "drum intro", "guitar intro", "band intro"] as const;
export const END_CUES = ["cold stop", "repeat and fade", "ritard", "tag"] as const;
export const CUE_LABEL: Record<string, string> = {
  "count off": "Count-off",
  "drum intro": "Drum intro",
  "guitar intro": "Guitar intro",
  "band intro": "Band intro",
  "cold stop": "Cold stop",
  "repeat and fade": "Repeat and fade",
  ritard: "Ritard",
  tag: "Tag",
};
const LABEL_GUESS = "label from repeat pattern";

export interface FormPart {
  line: number; // index of the section line in the doc
  label: string; // "V2"
  name: SectionName;
  number: number | null;
  repeat: number | null;
  bars: number;
  guessed: boolean; // label came from the repeat pattern and nobody has confirmed it
}

export interface WatchOut {
  part: number; // index into parts
  text: string;
  unclear: boolean;
}

export interface Structure {
  parts: FormPart[];
  formLine: string; // "Intro 4 · V 16 · C 8 x2 · Outro 4 cold stop"
  start: { cue: string | null; unclear: string | null };
  ending: { cue: string | null; unclear: string | null };
  watch: WatchOut[];
  hasSolo: boolean;
}

const isBar = (i: RowItem) => i.kind === "chord" || i.kind === "nc" || i.kind === "repeat" || i.kind === "split";
const unclearText = (l: Line) => (l.kind === "comment" && /^UNCLEAR:/i.test(l.text) ? l.text.replace(/^UNCLEAR:\s*/i, "") : null);

/** Section line indexes with their rows (section line rows + following rows lines). */
function sectionsOf(doc: ChartDoc) {
  const out: { line: number; rows: Row[]; lines: number[] }[] = [];
  doc.lines.forEach((l, i) => {
    if (l.kind === "section") out.push({ line: i, rows: [...l.rows], lines: [i] });
    else if (l.kind === "rows" && out.length) {
      out[out.length - 1].rows.push(...l.rows);
      out[out.length - 1].lines.push(i);
    }
  });
  return out;
}

/** Comment lines directly above a section line. */
function commentsAbove(doc: ChartDoc, line: number): number[] {
  const idx: number[] = [];
  for (let i = line - 1; i >= 0 && doc.lines[i].kind === "comment"; i--) idx.push(i);
  return idx;
}

export function readStructure(text: string): Structure {
  const { doc } = parseChart(text);
  const secs = sectionsOf(doc);
  const parts: FormPart[] = [];
  const watch: WatchOut[] = [];
  const allUnclear = doc.lines.map(unclearText);
  let start: Structure["start"] = { cue: null, unclear: null };
  let ending: Structure["ending"] = { cue: null, unclear: null };
  for (const u of allUnclear) {
    if (!u) continue;
    if (/^start:/i.test(u)) start.unclear = u.replace(/^start:\s*/i, "");
    if (/^ending:/i.test(u)) ending.unclear = u.replace(/^ending:\s*/i, "");
  }

  secs.forEach((s, pi) => {
    const l = doc.lines[s.line] as Extract<Line, { kind: "section" }>;
    const { name, number, repeat } = l.section;
    const label = `${name}${number ?? ""}`;
    const above = commentsAbove(doc, s.line).map((i) => allUnclear[i]).filter(Boolean) as string[];
    const items = s.rows.flat();
    parts.push({
      line: s.line,
      label,
      name,
      number,
      repeat,
      bars: items.filter(isBar).length,
      guessed: above.some((u) => u.includes(LABEL_GUESS)),
    });
    if (above.some((u) => /possible key change/.test(u))) watch.push({ part: pi, text: `Possible key change in ${label}`, unclear: true });
    let bar = 0;
    for (const it of items) {
      if (isBar(it)) bar++;
      if (it.kind === "cue") {
        const c = it.text.toLowerCase();
        if (pi === 0 && (START_CUES as readonly string[]).includes(c) && !start.cue) start = { cue: c, unclear: null };
        else if (pi === secs.length - 1 && (END_CUES as readonly string[]).includes(c)) ending = { cue: c, unclear: null };
        else watch.push({ part: pi, text: `“${it.text}” in ${label}`, unclear: false });
      } else if (it.kind === "tag" && (it.name === "key" || it.name === "mod")) {
        watch.push({ part: pi, text: it.name === "key" ? `Key change to ${it.value} in ${label}` : `Modulate ${it.value} in ${label}`, unclear: false });
      } else if (it.kind === "tag" && it.name === "bpm") {
        watch.push({ part: pi, text: `Tempo ${it.value} in ${label}`, unclear: false });
      } else if (it.kind === "tag" && it.name === "feel") {
        watch.push({ part: pi, text: `${it.value} feel in ${label}`, unclear: false });
      }
      const beats = it.kind === "split" ? it.beats : isBar(it) ? [it] : [];
      for (const b of beats) {
        if (b.kind === "chord" || b.kind === "nc") {
          if (b.end === "stop") watch.push({ part: pi, text: `Stop in ${label} bar ${bar}`, unclear: false });
          if (b.end === "fermata") watch.push({ part: pi, text: `Hold in ${label} bar ${bar}`, unclear: false });
        }
        if (b.kind === "nc" && !watch.some((w) => w.text === `No chord in ${label} bar ${bar}`))
          watch.push({ part: pi, text: `No chord in ${label} bar ${bar}`, unclear: false });
      }
    }
    if (name === "Solo") watch.push({ part: pi, text: `Solo: ${label}`, unclear: false });
  });

  const formLine = parts
    .map((p, i) => {
      let s = `${p.label} ${p.bars}${p.repeat ? ` x${p.repeat}` : ""}`;
      if (i === parts.length - 1 && ending.cue) s += ` ${CUE_LABEL[ending.cue].toLowerCase()}`;
      return s;
    })
    .join(" · ");
  return { parts, formLine, start, ending, watch, hasSolo: parts.some((p) => p.name === "Solo") };
}

// ── edits: each takes chart text and returns new canonical chart text ─────────

function edit(text: string, fn: (doc: ChartDoc) => void): string {
  const { doc } = parseChart(text);
  fn(doc);
  return serializeChart(doc);
}

function dropComments(doc: ChartDoc, test: (u: string) => boolean, only?: number[]) {
  doc.lines = doc.lines.filter((l, i) => {
    const u = unclearText(l);
    return !(u && test(u) && (!only || only.includes(i)));
  });
}

/** Rename (or confirm) a section. Removes the "label from repeat pattern" flag above it. */
export function renamePart(text: string, line: number, name: SectionName, number: number | null): string {
  if (!SECTION_NAMES.includes(name)) throw new Error("Unknown section name");
  return edit(text, (doc) => {
    const l = doc.lines[line];
    if (l?.kind !== "section") throw new Error("Section not found");
    l.section = { ...l.section, name, number: number && number > 1 ? number : null };
    dropComments(doc, (u) => u.includes(LABEL_GUESS), commentsAbove(doc, line));
  });
}

export function setRepeat(text: string, line: number, repeat: number | null): string {
  return edit(text, (doc) => {
    const l = doc.lines[line];
    if (l?.kind !== "section") throw new Error("Section not found");
    l.section = { ...l.section, repeat: repeat && repeat > 1 ? Math.min(repeat, 16) : null };
  });
}

function sectionRows(doc: ChartDoc, which: "first" | "last"): Row[] | null {
  const secs = doc.lines.filter((l): l is Extract<Line, { kind: "section" }> => l.kind === "section");
  const sec = which === "first" ? secs[0] : secs[secs.length - 1];
  if (!sec) return null;
  if (which === "last") {
    // the section's rows continue on following "rows" lines
    const at = doc.lines.indexOf(sec);
    let lastRows: Row[] = sec.rows;
    for (let i = at + 1; i < doc.lines.length && doc.lines[i].kind !== "section"; i++) {
      const l = doc.lines[i];
      if (l.kind === "rows") lastRows = l.rows;
    }
    return lastRows;
  }
  return sec.rows;
}

const stripCues = (rows: Row[], set: readonly string[]) => {
  for (let r = 0; r < rows.length; r++)
    rows[r] = rows[r].filter((i) => !(i.kind === "cue" && set.includes(i.text.toLowerCase())));
};

/** How the song starts (cue at the start of the first section), or null to clear. */
export function setStart(text: string, cue: (typeof START_CUES)[number] | null): string {
  return edit(text, (doc) => {
    const secs = doc.lines.filter((l): l is Extract<Line, { kind: "section" }> => l.kind === "section");
    if (!secs.length) throw new Error("No sections");
    stripCues(secs[0].rows, START_CUES);
    if (cue) {
      if (!secs[0].rows.length) secs[0].rows.push([]);
      secs[0].rows[0].unshift({ kind: "cue", text: cue });
      dropComments(doc, (u) => /^start:/i.test(u));
    }
  });
}

/** How the song ends (cue after the last bar), or null to clear. */
export function setEnding(text: string, cue: (typeof END_CUES)[number] | null): string {
  return edit(text, (doc) => {
    const secs = doc.lines.filter((l): l is Extract<Line, { kind: "section" }> => l.kind === "section");
    const last = secs[secs.length - 1];
    if (!last) throw new Error("No sections");
    const at = doc.lines.indexOf(last);
    for (let i = at; i < doc.lines.length; i++) {
      const l = doc.lines[i];
      if (i > at && l.kind === "section") break;
      if (l.kind === "section" || l.kind === "rows") stripCues(l.rows, END_CUES);
    }
    if (cue) {
      const rows = sectionRows(doc, "last")!;
      if (!rows.length) rows.push([]);
      rows[rows.length - 1].push({ kind: "cue", text: cue });
      dropComments(doc, (u) => /^ending:/i.test(u));
    }
  });
}

/** A short watch-out cue at the start of a section. Never lyrics: 6 words or fewer. */
export function addCue(text: string, line: number, cue: string): string {
  const c = cue.replace(/["{}[\]|#]/g, "").replace(/\s+/g, " ").trim();
  if (!c) throw new Error("Type a short cue.");
  if (c.split(" ").length > MAX_CUE_WORDS) throw new Error(`Cues are ${MAX_CUE_WORDS} words or fewer (never lyrics).`);
  return edit(text, (doc) => {
    const l = doc.lines[line];
    if (l?.kind !== "section") throw new Error("Section not found");
    if (!l.rows.length) l.rows.push([]);
    l.rows[0].unshift({ kind: "cue", text: c });
  });
}

export function removeCue(text: string, line: number, cue: string): string {
  return edit(text, (doc) => {
    for (let i = line; i < doc.lines.length; i++) {
      const l = doc.lines[i];
      if (i > line && l.kind === "section") break;
      if (l.kind === "section" || l.kind === "rows")
        l.rows = l.rows.map((r) => r.filter((it) => !(it.kind === "cue" && it.text === cue)));
    }
  });
}

/** Bar index (0-based, across the whole chart in order) where each section starts. */
export function sectionStartBars(text: string): { line: number; label: string; bar: number; bars: number }[] {
  const { doc } = parseChart(text);
  let bar = 0;
  return sectionsOf(doc).map((s) => {
    const l = doc.lines[s.line] as Extract<Line, { kind: "section" }>;
    const bars = s.rows.flat().filter(isBar).length * (l.section.repeat ?? 1);
    const out = { line: s.line, label: `${l.section.name}${l.section.number ?? ""}`, bar, bars };
    bar += bars;
    return out;
  });
}
