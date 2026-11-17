// "Song details" for a fill-in player (app/upload/CheatSheet.tsx), read from (and written back to) the
// chart text, so the chart stays the one source of truth. Form = the sections in order with
// bar counts and repeats; start / ending / watch-outs come from cue words and symbols.
import { parseChart } from "../chart/parse";
import { serializeChart } from "../chart/serialize";
import { parseKey } from "../chart/transpose";
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

/**
 * A detail written in "Other" words: a cue "start: piano alone" at the top of the first
 * section, "end: big hold" at the end of the last (docs/CHART_FORMAT.md, Song details).
 */
const START_OTHER = /^start:\s*(\S.*)$/i;
const END_OTHER = /^end:\s*(\S.*)$/i;
/** A cue naming a solo spot ("solo", "guitar solo"). */
const SOLO_CUE = /\bsolos?\b/i;
/** Cue words that are stops and breaks. */
const STOP_CUE = /\b(?:stops?|breaks?|band out|drums only|hits?|hold)\b/i;
/**
 * "# ADDED BY A PLAYER: start" directly above a section: that detail of the section was
 * filled in by a player, not by the original chart or the file. Fields: start, ending, solo,
 * stop, key. Written by the server on save (lib/upload/details.ts markAdded).
 */
export const ADDED_MARK = "ADDED BY A PLAYER:";
export type MarkField = "start" | "ending" | "solo" | "stop" | "key";
const markOf = (l: Line) =>
  l.kind === "comment" && l.text.startsWith(ADDED_MARK) ? (l.text.slice(ADDED_MARK.length).trim() as MarkField) : null;

const isStartCue = (c: string) => (START_CUES as readonly string[]).includes(c.toLowerCase()) || START_OTHER.test(c);
const isEndCue = (c: string) => (END_CUES as readonly string[]).includes(c.toLowerCase()) || END_OTHER.test(c);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** What the Starts / Ends line reads for a start or end cue. */
export function cueLabel(cue: string): string {
  const other = START_OTHER.exec(cue) ?? END_OTHER.exec(cue);
  return other ? cap(other[1]) : (CUE_LABEL[cue.toLowerCase()] ?? cap(cue));
}

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
  unclear: boolean; // only "Possible key change" (kind "keyq"): a question for the owner
  kind: "cue" | "stop" | "key" | "tempo" | "feel" | "solo" | "keyq";
  byPlayer: boolean; // a player added it (ADDED_MARK above the section)
}

export interface StartEnd {
  cue: string | null; // the cue as written ("count off", "start: piano alone")
  unclear: string | null; // the # UNCLEAR note's words, for the owner's screens
  byPlayer: boolean;
}

export interface SoloSpot {
  part: number;
  who: string | null; // "guitar solo" when the cue says more than "solo"
  byPlayer: boolean;
}

export interface Structure {
  parts: FormPart[];
  formLine: string; // "Intro 4 · V 16 · C 8 x2 · Outro 4 cold stop"
  start: StartEnd;
  ending: StartEnd;
  watch: WatchOut[];
  hasSolo: boolean;
  solos: SoloSpot[];
  hasStops: boolean; // any stop, hold, no-chord bar or stop/break cue
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
  const solos: SoloSpot[] = [];
  const allUnclear = doc.lines.map(unclearText);
  const marks = secs.map((s) => new Set(commentsAbove(doc, s.line).map((i) => markOf(doc.lines[i])).filter(Boolean)));
  const last = secs.length - 1;
  let start: StartEnd = { cue: null, unclear: null, byPlayer: false };
  let ending: StartEnd = { cue: null, unclear: null, byPlayer: false };
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
    const mark = marks[pi];
    const add = (kind: WatchOut["kind"], text: string) => {
      const field: MarkField | null = kind === "cue" || kind === "stop" ? "stop" : kind === "key" || kind === "solo" ? kind : null;
      watch.push({ part: pi, text, unclear: kind === "keyq", kind, byPlayer: !!field && mark.has(field) });
    };
    parts.push({
      line: s.line,
      label,
      name,
      number,
      repeat,
      bars: items.filter(isBar).length,
      guessed: above.some((u) => u.includes(LABEL_GUESS)),
    });
    if (above.some((u) => /possible key change/.test(u))) add("keyq", `Possible key change in ${label}`);
    if (name === "Solo") solos.push({ part: pi, who: null, byPlayer: mark.has("solo") });
    let bar = 0;
    for (const it of items) {
      if (isBar(it)) bar++;
      if (it.kind === "cue") {
        const c = it.text;
        if (pi === 0 && isStartCue(c) && !start.cue) start = { cue: c, unclear: null, byPlayer: mark.has("start") };
        else if (pi === last && isEndCue(c)) ending = { cue: c, unclear: null, byPlayer: mark.has("ending") };
        else if (SOLO_CUE.test(c)) {
          const who = /^solos?$/i.test(c) ? null : c;
          const had = solos.find((x) => x.part === pi);
          if (had) had.who ??= who;
          else solos.push({ part: pi, who, byPlayer: mark.has("solo") });
        } else add("cue", `“${c}” in ${label}`);
      } else if (it.kind === "tag" && (it.name === "key" || it.name === "mod")) {
        add("key", it.name === "key" ? `Key change to ${it.value} in ${label}` : `Modulate ${it.value} in ${label}`);
      } else if (it.kind === "tag" && it.name === "bpm") {
        add("tempo", `Tempo ${it.value} in ${label}`);
      } else if (it.kind === "tag" && it.name === "feel") {
        add("feel", `${it.value} feel in ${label}`);
      }
      const beats = it.kind === "split" ? it.beats : isBar(it) ? [it] : [];
      for (const b of beats) {
        if (b.kind === "chord" || b.kind === "nc") {
          if (b.end === "stop") add("stop", `Stop in ${label} bar ${bar}`);
          if (b.end === "fermata") add("stop", `Hold in ${label} bar ${bar}`);
        }
        if (b.kind === "nc" && !watch.some((w) => w.text === `No chord in ${label} bar ${bar}`)) add("stop", `No chord in ${label} bar ${bar}`);
      }
    }
    if (name === "Solo") add("solo", `Solo: ${label}`);
  });

  const formLine = parts
    .map((p, i) => {
      let s = `${p.label} ${p.bars}${p.repeat ? ` x${p.repeat}` : ""}`;
      if (i === parts.length - 1 && ending.cue) s += ` ${cueLabel(ending.cue).toLowerCase()}`;
      return s;
    })
    .join(" · ");
  const hasStops = watch.some((w) => w.kind === "stop" || (w.kind === "cue" && STOP_CUE.test(w.text)));
  return { parts, formLine, start, ending, watch, hasSolo: solos.length > 0, solos, hasStops };
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

const stripCues = (rows: Row[], test: (cue: string) => boolean) => {
  for (let r = 0; r < rows.length; r++) rows[r] = rows[r].filter((i) => !(i.kind === "cue" && test(i.text)));
};

/** How the song starts (cue at the start of the first section: a START_CUES word or "start: …"), or null to clear. */
export function setStart(text: string, cue: string | null): string {
  return edit(text, (doc) => {
    const secs = doc.lines.filter((l): l is Extract<Line, { kind: "section" }> => l.kind === "section");
    if (!secs.length) throw new Error("No sections");
    stripCues(secs[0].rows, isStartCue);
    if (cue) {
      if (!secs[0].rows.length) secs[0].rows.push([]);
      secs[0].rows[0].unshift({ kind: "cue", text: cue });
      dropComments(doc, (u) => /^start:/i.test(u));
    }
  });
}

/** How the song ends (cue after the last bar: an END_CUES word or "end: …"), or null to clear. */
export function setEnding(text: string, cue: string | null): string {
  return edit(text, (doc) => {
    const secs = doc.lines.filter((l): l is Extract<Line, { kind: "section" }> => l.kind === "section");
    const last = secs[secs.length - 1];
    if (!last) throw new Error("No sections");
    const at = doc.lines.indexOf(last);
    for (let i = at; i < doc.lines.length; i++) {
      const l = doc.lines[i];
      if (i > at && l.kind === "section") break;
      if (l.kind === "section" || l.kind === "rows") stripCues(l.rows, isEndCue);
    }
    if (cue) {
      const rows = sectionRows(doc, "last")!;
      if (!rows.length) rows.push([]);
      rows[rows.length - 1].push({ kind: "cue", text: cue });
      dropComments(doc, (u) => /^ending:/i.test(u));
    }
  });
}

/** A cue's words cleaned for the chart text; throws when empty or longer than `max` words. */
export function cleanCue(cue: string, max = MAX_CUE_WORDS): string {
  const c = cue.replace(/["{}[\]|#]/g, "").replace(/\s+/g, " ").trim();
  if (!c) throw new Error("Type a few words.");
  if (c.split(" ").length > max) throw new Error(`${max} words or fewer (never lyrics).`);
  return c;
}

/** A short watch-out cue at the start of a section. Never lyrics: 6 words or fewer. */
export function addCue(text: string, line: number, cue: string): string {
  const c = cleanCue(cue);
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

/**
 * Answer a "possible key change" question for a section: "+1"/"-2" (half steps, {mod:}),
 * a key name ("D", "Bbm": {key:}) at the start of the section, or "none". Either way the
 * question note above the section goes.
 */
export function setKeyChange(text: string, line: number, change: string): string {
  const v = change.trim();
  const tag = /^[+-]\d{1,2}$/.test(v) ? "mod" : v === "none" ? null : parseKey(v) ? "key" : undefined;
  if (tag === undefined) throw new Error("Type a key like D, Bb or F#m.");
  return edit(text, (doc) => {
    const l = doc.lines[line];
    if (l?.kind !== "section") throw new Error("Section not found");
    if (tag) {
      if (!l.rows.length) l.rows.push([]);
      l.rows[0].unshift({ kind: "tag", name: tag, value: v });
    }
    dropComments(doc, (u) => /possible key change/.test(u), commentsAbove(doc, line));
  });
}

/** Write ADDED_MARK notes above sections (part = index into the sections), once each. */
export function addMarks(text: string, marks: { part: number; field: MarkField }[]): string {
  if (!marks.length) return text;
  return edit(text, (doc) => {
    // last part first, so earlier line indexes stay right
    for (const m of [...marks].sort((a, b) => b.part - a.part)) {
      const sec = sectionsOf(doc)[m.part];
      if (!sec) continue;
      if (commentsAbove(doc, sec.line).some((i) => markOf(doc.lines[i]) === m.field)) continue;
      doc.lines.splice(sec.line, 0, { kind: "comment", text: `${ADDED_MARK} ${m.field}` });
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

// ── the song map: section chips for players ("Verse ·16", tap to jump) ────────

export const SECTION_FULL: Record<SectionName, string> = {
  Intro: "Intro",
  V: "Verse",
  Pre: "Pre-chorus",
  C: "Chorus",
  B: "Bridge",
  Solo: "Solo",
  Turn: "Turnaround",
  Tag: "Tag",
  Outro: "Outro",
};

export interface MapChip {
  part: number; // index into Structure.parts (and the chart's sections, in order)
  name: string | null; // "Verse 2"; null = nobody knows what this part is yet
  bars: number;
  repeat: number | null;
}

/**
 * Real section names for the map. Parts a person named keep their name. Parts the audio
 * analysis labelled from the repeat pattern keep that name when the pattern says what they
 * are (Verse, Chorus, Pre-chorus, Turnaround, Intro, Outro). Its catch-all "B" (a part that
 * plays once) is a Bridge only when there is exactly one, after a chorus and leading back
 * into one; any other "B" is unknown (name null: "+ Name this section").
 */
export function songMap(s: Structure): MapChip[] {
  const loose = s.parts.map((p, i) => (p.guessed && p.name === "B" ? i : -1)).filter((i) => i >= 0);
  const isChorus = (i: number) => s.parts[i]?.name === "C";
  const bridge =
    loose.length === 1 && s.parts.slice(0, loose[0]).some((p) => p.name === "C") && isChorus(loose[0] + 1) ? loose[0] : -1;
  return s.parts.map((p, i) => {
    let name: string | null = `${SECTION_FULL[p.name]}${p.number ? ` ${p.number}` : ""}`;
    if (p.guessed && p.name === "B") name = i === bridge ? "Bridge" : null;
    return { part: i, name, bars: p.bars, repeat: p.repeat };
  });
}
