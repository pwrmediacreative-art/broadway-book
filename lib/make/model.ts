// The tap-to-build editor's model (Q16): a player-made chart as a header plus a list of
// sections, each a flat list of chart items. Everything saved is our normal chart text
// (docs/CHART_FORMAT.md), written by the serializer, so it always round-trips.
// Pure functions only, so the editor's rules can be tested.
import { getMeta, parseChart } from "../chart/parse";
import { itemText, serializeChart } from "../chart/serialize";
import { parseKey } from "../chart/transpose";
import { buildView, sectionName } from "../chart/view";
import { MAX_CUE_WORDS } from "../chart/validate";
import {
  MAX_SECTION_NAME,
  type BeatItem,
  type ChartDoc,
  type ChordItem,
  type Line,
  type Row,
  type RowItem,
  type SectionLabel,
  type SectionName,
  type Tag,
} from "../chart/types";

export const TIMES = ["4/4", "3/4", "6/8", "2/4", "12/8"] as const;
export const BARS_PER_ROW = 4;
export const MIN_BPM = 20;
export const MAX_BPM = 400;

/** The "+ Add section" list, in the order players think of a song. */
export const SECTION_TYPES: { name: SectionName; label: string }[] = [
  { name: "Intro", label: "Intro" },
  { name: "V", label: "Verse" },
  { name: "Pre", label: "Pre-chorus" },
  { name: "C", label: "Chorus" },
  { name: "B", label: "Bridge" },
  { name: "Solo", label: "Solo" },
  { name: "Turn", label: "Turnaround" },
  { name: "Tag", label: "Tag" },
  { name: "Outro", label: "Outro" },
];
/** "Verse 2", "Chorus", "Big ending 2" (repeat not included). Same names as Full song. */
export const partName = (l: SectionLabel): string => sectionName(l);

export interface Header {
  title: string;
  artist: string;
  key: string | null;
  time: string;
  bpm: number | null;
  extra: Tag[]; // other header tags kept as they are (feel, tags, numbers)
}

export interface Part {
  id: string;
  label: SectionLabel;
  items: RowItem[];
  comments: string[]; // "# ..." lines kept above the section (e.g. song details marks)
  from: string | null; // id of the section this was duplicated from (this editing session only)
}

export interface Made {
  header: Header;
  parts: Part[];
}

export const isBar = (i: RowItem | undefined): i is BeatItem | Extract<RowItem, { kind: "split" }> =>
  !!i && (i.kind === "chord" || i.kind === "nc" || i.kind === "repeat" || i.kind === "split");

let seq = 0;
/** A new section id (for React keys and duplicate links; never saved). */
export const newId = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`;

// ── header ───────────────────────────────────────────────────────────────────

const clean = (s: string) => s.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();

export function cleanBpm(n: number | null): number | null {
  if (n === null || !Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= MIN_BPM && r <= MAX_BPM && r <= 999 ? r : null;
}

/** Header problems the player must fix (title is the only required field). */
export function headerError(h: Pick<Header, "title" | "artist" | "key" | "time">): string | null {
  if (!clean(h.title)) return "Give the song a title.";
  if (clean(h.title).length > 200) return "Keep the title under 200 characters.";
  if (clean(h.artist).length > 200) return "Keep the artist under 200 characters.";
  if (h.key && !parseKey(h.key)) return "Pick a key from the list.";
  if (!(TIMES as readonly string[]).includes(h.time) && !/^\d{1,2}\/\d{1,2}$/.test(h.time)) return "Pick a time signature.";
  return null;
}

export function headerLines(h: Header): string[] {
  const out = [`{title: ${clean(h.title)}}`];
  if (clean(h.artist)) out.push(`{artist: ${clean(h.artist)}}`);
  const bpm = cleanBpm(h.bpm);
  const third = [h.key ? `{key: ${h.key}}` : "", bpm ? `{bpm: ${bpm}}` : "", `{time: ${h.time}}`].filter(Boolean);
  out.push(third.join(" "));
  if (h.extra.length) out.push(h.extra.map((t) => (t.value ? `{${t.name}: ${t.value}}` : `{${t.name}:}`)).join(" "));
  return out;
}

// ── text <-> model ───────────────────────────────────────────────────────────

/** Section items split into rows of BARS_PER_ROW bars; notes before a bar stay with it. */
export function chunkRows(items: RowItem[]): Row[] {
  const rows: Row[] = [];
  let row: Row = [];
  let bars = 0;
  let pending: RowItem[] = [];
  for (const it of items) {
    if (isBar(it)) {
      if (bars === BARS_PER_ROW) {
        rows.push(row);
        row = [];
        bars = 0;
      }
      row.push(...pending, it);
      pending = [];
      bars++;
    } else if (it.kind === "repeatSign" && it.side === "end") {
      row.push(...pending, it); // :| closes the bar before it, on the same line
      pending = [];
    } else pending.push(it);
  }
  row.push(...pending);
  if (row.length) rows.push(row);
  return rows;
}

export function toDoc(m: Made): ChartDoc {
  const text = headerLines(m.header).join("\n") + "\n";
  const lines: Line[] = parseChart(text).doc.lines;
  for (const p of m.parts) {
    for (const c of p.comments) lines.push({ kind: "comment", text: c });
    lines.push({ kind: "section", section: p.label, rows: chunkRows(p.items) });
  }
  return { version: 1, lines };
}

/** Canonical chart text for the model. */
export function toText(m: Made): string {
  return serializeChart(toDoc(m));
}

/** Read a chart into the editor model. Throws ChartParseError on bad text. */
export function fromText(text: string): Made {
  const { doc } = parseChart(text);
  const meta = getMeta(doc);
  const extra: Tag[] = [];
  const parts: Part[] = [];
  let comments: string[] = [];
  let carry: RowItem[] = []; // tag lines between sections belong to the next one
  for (const line of doc.lines) {
    if (line.kind === "section") {
      parts.push({ id: `s${parts.length}`, label: line.section, items: [...carry, ...line.rows.flat()], comments, from: null });
      comments = [];
      carry = [];
    } else if (line.kind === "rows" && parts.length) {
      parts.at(-1)!.items.push(...line.rows.flat());
    } else if (line.kind === "comment") {
      comments.push(line.text);
    } else if (line.kind === "tags") {
      if (!parts.length) {
        for (const t of line.tags) if (!["title", "artist", "key", "bpm", "time"].includes(t.name)) extra.push(t);
      } else carry.push(...line.tags.map((t) => ({ kind: "tag" as const, ...t })));
    }
  }
  if (carry.length && parts.length) parts.at(-1)!.items.push(...carry);
  return {
    header: {
      title: meta.title ?? "",
      artist: meta.artist ?? "",
      key: meta.key,
      time: meta.time ?? "4/4",
      bpm: meta.bpm,
      extra,
    },
    parts,
  };
}

/** Can the editor open this chart and write it back without changing what players read?
 *  Same header values, sections, bars, notes and "#" comments. Header line order, row breaks
 *  and where a comment sits may change; a missing time becomes the 4/4 default. Library charts
 *  come in many shapes (bars or notes before the first section, comments after the last one)
 *  that the editor model doesn't keep, so the Full song Edit (Q17) checks this first. */
export function editorKeeps(text: string): boolean {
  try {
    const before = parseChart(text).doc;
    const after = parseChart(toText(fromText(text))).doc;
    const look = (doc: ChartDoc) => {
      const v = buildView(doc);
      const comments = doc.lines.flatMap((l) => (l.kind === "comment" ? [l.text] : [])).sort();
      const sections = v.sections.map((s) => [s.label, s.repeat, s.rows.flat()]);
      return JSON.stringify({ meta: { ...v.meta, time: v.meta.time ?? "4/4" }, sections, comments });
    };
    return look(before) === look(after);
  } catch {
    return false;
  }
}

/** A brand-new chart: just the header. */
export function newChartText(h: Omit<Header, "extra">): string {
  return toText({ header: { ...h, title: clean(h.title), artist: clean(h.artist), bpm: cleanBpm(h.bpm), extra: [] }, parts: [] });
}

// ── sections ─────────────────────────────────────────────────────────────────

/** Next number for a section of this name: none if it's the first, else highest + 1 (unnumbered = 1). */
export function nextNumber(parts: Part[], name: string, custom: boolean): number | null {
  const same = parts.filter((p) => p.label.name === name && p.label.custom === custom);
  if (!same.length) return null;
  return Math.max(...same.map((p) => p.label.number ?? 1)) + 1;
}

/** Problems with a custom section name, or null. */
export function customNameError(name: string): string | null {
  const n = name.replace(/\s+/g, " ").trim();
  if (!n) return "Type a name.";
  if (n.length > MAX_SECTION_NAME) return `Keep it to ${MAX_SECTION_NAME} characters.`;
  if (n.split(" ").length > MAX_CUE_WORDS) return `Keep it to ${MAX_CUE_WORDS} words.`;
  if (/["[\]{}|#]/.test(n)) return 'Leave out [ ] { } | # and ".';
  return null;
}

export function makeLabel(parts: Part[], name: string, custom: boolean): SectionLabel {
  const n = custom ? name.replace(/\s+/g, " ").trim() : name;
  return { name: n, custom, number: nextNumber(parts, n, custom), repeat: null };
}

export function addPart(m: Made, label: SectionLabel, at = m.parts.length): { made: Made; id: string } {
  const id = newId();
  const parts = [...m.parts];
  parts.splice(at, 0, { id, label, items: [], comments: [], from: null });
  return { made: { ...m, parts }, id };
}

const copyItem = <T extends RowItem>(i: T): T => structuredClone(i);

/** Duplicate a section: a full independent copy right after it, with the next number. */
export function duplicatePart(m: Made, id: string): { made: Made; id: string } {
  const i = m.parts.findIndex((p) => p.id === id);
  if (i < 0) return { made: m, id };
  const src = m.parts[i];
  const copy: Part = {
    id: newId(),
    label: { ...src.label, number: nextNumber(m.parts, src.label.name, src.label.custom) },
    items: src.items.map(copyItem),
    comments: [],
    from: src.id,
  };
  const parts = [...m.parts];
  parts.splice(i + 1, 0, copy);
  return { made: { ...m, parts }, id: copy.id };
}

export function movePart(m: Made, id: string, dir: -1 | 1): Made {
  const i = m.parts.findIndex((p) => p.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= m.parts.length) return m;
  const parts = [...m.parts];
  [parts[i], parts[j]] = [parts[j], parts[i]];
  return { ...m, parts };
}

export function removePart(m: Made, id: string): Made {
  return { ...m, parts: m.parts.filter((p) => p.id !== id) };
}

export function renamePart(m: Made, id: string, label: SectionLabel): Made {
  return { ...m, parts: m.parts.map((p) => (p.id === id ? { ...p, label } : p)) };
}

export function setRepeat(m: Made, id: string, times: number): Made {
  const r = Math.max(1, Math.min(9, Math.round(times)));
  return { ...m, parts: m.parts.map((p) => (p.id === id ? { ...p, label: { ...p.label, repeat: r > 1 ? r : null } } : p)) };
}

/** Bars of a duplicated section that differ from the section it was copied from (by bar position). */
export function changedBars(m: Made, id: string): Set<number> {
  const p = m.parts.find((x) => x.id === id);
  const src = p?.from ? m.parts.find((x) => x.id === p.from) : null;
  const out = new Set<number>();
  if (!p || !src) return out;
  const a = src.items.filter(isBar).map(itemText);
  const b = p.items.filter(isBar).map(itemText);
  b.forEach((t, k) => {
    if (a[k] !== t) out.add(k);
  });
  return out;
}

// ── items ────────────────────────────────────────────────────────────────────

export function setItems(m: Made, id: string, items: RowItem[]): Made {
  return { ...m, parts: m.parts.map((p) => (p.id === id ? { ...p, items } : p)) };
}

export function insertItems(items: RowItem[], at: number, add: RowItem[]): RowItem[] {
  const out = [...items];
  out.splice(at, 0, ...add.map(copyItem));
  return out;
}

export const chord = (acc: "" | "b" | "#", degree: number): ChordItem => ({
  kind: "chord",
  root: { acc, degree },
  quality: "",
  bass: null,
  push: false,
  diamond: false,
  end: "",
});

// Chord quality, in the format's fixed order: - | maj7 maj9 dim dim7 aug + | ext | sus | add | alterations.
const QPARTS = /^(-?)(maj7|maj9|dim7|dim|aug|\+)?(2|4|6|7|9|11|13)?(sus[24]?)?(add(?:2|4|9|11|13))?((?:[b#](?:5|9|11|13))*)$/;
interface Q {
  minor: string;
  kind: string;
  ext: string;
  sus: string;
  add: string;
  alt: string;
}
function qParts(q: string): Q {
  const m = QPARTS.exec(q);
  if (!m) return { minor: "", kind: "", ext: "", sus: "", add: "", alt: "" };
  return { minor: m[1], kind: m[2] ?? "", ext: m[3] ?? "", sus: m[4] ?? "", add: m[5] ?? "", alt: m[6] ?? "" };
}
const qText = (q: Q) => q.minor + q.kind + q.ext + q.sus + q.add + q.alt;

export type QualityKey = "minor" | "7" | "maj7" | "sus";

/** Toggle one number-pad quality key on a chord quality string. */
export function toggleQuality(quality: string, key: QualityKey): string {
  const q = qParts(quality);
  if (key === "minor") {
    q.minor = q.minor ? "" : "-";
    if (q.minor && /^(dim|dim7|aug|\+)$/.test(q.kind)) q.kind = "";
  } else if (key === "7") {
    if (q.kind === "dim7") q.kind = "dim";
    else if (q.kind === "dim" && !q.ext) q.kind = "dim7";
    else if (q.ext === "7") q.ext = "";
    else {
      q.ext = "7";
      if (q.kind === "maj7" || q.kind === "maj9") q.kind = "";
    }
  } else if (key === "maj7") {
    if (q.kind === "maj7") q.kind = "";
    else {
      q.kind = "maj7";
      q.ext = "";
    }
  } else {
    q.sus = q.sus ? "" : "sus";
  }
  return qText(q);
}

/** Which pad quality keys are lit for a quality. */
export function qualityFlags(quality: string): Record<QualityKey, boolean> {
  const q = qParts(quality);
  return { minor: !!q.minor, "7": q.ext === "7" || q.kind === "dim7", maj7: q.kind === "maj7", sus: !!q.sus };
}

/** The "More" key: every other chord type the format supports. Each sets the whole quality. */
export const MORE_QUALITIES: { q: string; label: string }[] = [
  { q: "", label: "Plain" },
  { q: "-7", label: "−7" },
  { q: "6", label: "6" },
  { q: "-6", label: "−6" },
  { q: "9", label: "9" },
  { q: "-9", label: "−9" },
  { q: "maj9", label: "maj9" },
  { q: "add9", label: "add9" },
  { q: "11", label: "11" },
  { q: "13", label: "13" },
  { q: "sus2", label: "sus2" },
  { q: "sus4", label: "sus4" },
  { q: "7sus", label: "7sus" },
  { q: "dim", label: "dim" },
  { q: "dim7", label: "dim7" },
  { q: "-7b5", label: "−7♭5" },
  { q: "aug", label: "aug" },
  { q: "7b9", label: "7♭9" },
  { q: "7#9", label: "7♯9" },
  { q: "7#5", label: "7♯5" },
];

/** The last chord-like beat of a bar (where modifiers and quality keys land). */
export function lastBeat(bar: RowItem): BeatItem | null {
  if (bar.kind === "split") return bar.beats.at(-1) ?? null;
  return isBar(bar) ? (bar as BeatItem) : null;
}

/** Change the last beat of a bar. */
export function withLastBeat(bar: RowItem, f: (b: BeatItem) => BeatItem): RowItem {
  if (bar.kind === "split") return { ...bar, beats: [...bar.beats.slice(0, -1), f(bar.beats.at(-1)!)] };
  return isBar(bar) ? f(bar as BeatItem) : bar;
}

/** Add a chord to a bar: a plain bar becomes a split bar. */
export function addBeat(bar: RowItem, b: BeatItem): RowItem {
  if (bar.kind === "split") return { ...bar, beats: [...bar.beats, b] };
  return isBar(bar) ? { kind: "split", beats: [bar as BeatItem, b] } : bar;
}

/** Remove a split bar's last chord (a split bar of one becomes a plain bar). */
export function dropBeat(bar: RowItem): RowItem | null {
  if (bar.kind !== "split") return null;
  const beats = bar.beats.slice(0, -1);
  return beats.length >= 2 ? { ...bar, beats } : beats[0];
}

/** Problems with a boxed note's text, or null. */
export function noteError(text: string): string | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "Type a note.";
  if (t.split(" ").length > MAX_CUE_WORDS) return `Keep notes to ${MAX_CUE_WORDS} words (no lyrics).`;
  if (/"/.test(t)) return 'Leave out the " mark.';
  return null;
}
export const cleanNote = (text: string) => text.replace(/\s+/g, " ").trim();

// ── key changes ──────────────────────────────────────────────────────────────

const DEGREE_OF_SEMIS = ["1", "b2", "2", "b3", "3", "4", "#4", "5", "b6", "6", "b7", "7"];

/** Quick picks for a key change. The numbers after it stay as written, read in the new key. */
export const KEY_CHANGES: { semis: number; label: string; short: string }[] = [
  { semis: 1, label: "Up ½ step", short: "↑ half" },
  { semis: 2, label: "Up whole step", short: "↑ whole" },
  { semis: 3, label: "Up m3", short: "↑ m3" },
  { semis: 4, label: "Up M3", short: "↑ M3" },
  { semis: 5, label: "Up P.4th", short: "↑ P.4th" },
  { semis: 7, label: "Up P.5th", short: "↑ P.5th" },
  { semis: -1, label: "Down ½ step", short: "↓ half" },
  { semis: -2, label: "Down whole step", short: "↓ whole" },
];

/** What the old "1" is called in the new key: up a 4th -> 5, up a half step -> 7. */
export function oldOneBecomes(semis: number): string {
  return DEGREE_OF_SEMIS[(((-semis % 12) + 12) % 12)];
}

/** The items a key-change quick pick writes: {mod: +5} "[Mod ↑ P.4th (1 becomes 5)]". */
export function keyChangeItems(semis: number): RowItem[] {
  const pick = KEY_CHANGES.find((k) => k.semis === semis);
  const text = `Mod ${pick ? pick.short : `${semis > 0 ? "↑" : "↓"} ${Math.abs(semis)}`} (1 becomes ${oldOneBecomes(semis)})`;
  return [
    { kind: "tag", name: "mod", value: `${semis > 0 ? "+" : ""}${semis}` },
    { kind: "box", text },
  ];
}
