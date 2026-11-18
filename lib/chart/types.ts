// Structured form of a Broadway Book chart. See docs/CHART_FORMAT.md.

export type Accidental = "" | "b" | "#";

/** A scale degree relative to the chart's "1" (e.g. b7 = { acc: "b", degree: 7 }). */
export interface Degree {
  acc: Accidental;
  degree: number; // 1-7
}

/** Modifiers any chord or N.C. can carry. */
export interface Mods {
  push: boolean; // ^  anticipation
  diamond: boolean; // <1> hold / let ring
  end: "" | "fermata" | "stop"; // ~ or !
}

export interface ChordItem extends Mods {
  kind: "chord";
  root: Degree;
  quality: string; // as written, e.g. "-", "maj7", "-7b5", "sus4"
  bass: Degree | null; // slash bass, e.g. 1/3
}

export interface NoChordItem extends Mods {
  kind: "nc";
}

export interface RepeatItem {
  kind: "repeat"; // %  repeat previous bar
}

export type BeatItem = ChordItem | NoChordItem | RepeatItem;

/** More than one chord in one bar: (1 4) */
export interface SplitBar {
  kind: "split";
  beats: BeatItem[];
}

export interface DynamicItem {
  kind: "dynamic";
  value: "cresc" | "decresc"; // << or >>
}

export interface CueItem {
  kind: "cue";
  text: string; // "drums only" (short, never lyrics)
}

export interface TagItem {
  kind: "tag";
  name: string;
  value: string;
}

/** Boxed note: "[Mod ↑ P.4th (1 becomes 5)]". Short (6 words or fewer), never lyrics. */
export interface BoxItem {
  kind: "box";
  text: string;
}

/** Repeat sign: |: (start) or :| (end, optionally with a short note like "repeat out"). */
export interface RepeatSignItem {
  kind: "repeatSign";
  side: "start" | "end";
  text: string; // "" = none; end signs only
}

export type RowItem = BeatItem | SplitBar | DynamicItem | CueItem | TagItem | BoxItem | RepeatSignItem;

/** One chart line as players read it. Rows are separated by | in the text. */
export type Row = RowItem[];

export const SECTION_NAMES = [
  "Intro",
  "V",
  "Pre",
  "C",
  "B",
  "Solo",
  "Turn",
  "Tag",
  "Outro",
] as const;
export type SectionName = (typeof SECTION_NAMES)[number];

/** Longest custom section name, in characters. */
export const MAX_SECTION_NAME = 30;

export interface SectionLabel {
  name: string; // a SectionName, or the player's own name when `custom`
  custom: boolean; // ["Big ending"]: any name, written in quotes
  number: number | null; // [V2]
  repeat: number | null; // [C x2]
}

export interface Tag {
  name: string;
  value: string;
}

export type Line =
  | { kind: "tags"; tags: Tag[] }
  | { kind: "section"; section: SectionLabel; rows: Row[] }
  | { kind: "rows"; rows: Row[] }
  | { kind: "blank" }
  | { kind: "comment"; text: string };

export interface ChartDoc {
  version: 1;
  lines: Line[];
}

export type NumberStyle = "minor" | "relative";

export interface ChartMeta {
  title: string | null;
  artist: string | null;
  key: string | null;
  bpm: number | null;
  time: string | null;
  feel: string | null;
  tags: string[];
  numbers: NumberStyle;
}
