// "+ Add…" for Song details: a missing detail (how it starts, the ending, solo spots, stops
// and breaks, a possible key change) filled in from quick picks or a few words. Every
// answer is written into the chart text (lib/upload/structure), so the card and the chart
// stay one source of truth. markAdded() runs on the server on every save: it notes what a
// player filled in (ADDED_MARK, shown as "Added by a player") and returns the field keys
// for the player's count (song_detail_adds).
import { MAX_CUE_WORDS } from "../chart/validate";
import {
  addCue,
  addMarks,
  cleanCue,
  readStructure,
  setEnding,
  setKeyChange,
  setStart,
  type MarkField,
  type Structure,
} from "./structure";

/** Quick picks: [cue written into the chart, chip label]. */
export const START_PICKS = [
  ["count off", "Count-off"],
  ["drum intro", "Drums"],
  ["guitar intro", "Guitar intro"],
  ["band intro", "Full band"],
] as const;
export const END_PICKS = [
  ["cold stop", "Cold stop"],
  ["repeat and fade", "Fade"],
  ["ritard", "Ritard"],
  ["tag", "Tag"],
] as const;
export const STOP_PICKS = [
  ["stop", "Stop"],
  ["break", "Break"],
  ["band out", "Band out"],
  ["drums only", "Drums only"],
] as const;
export const KEY_PICKS = [
  ["+1", "Up a half step"],
  ["+2", "Up a whole step"],
  ["-1", "Down a half step"],
  ["none", "No key change"],
] as const;
/** "Other" words: one word goes to "start:" / "end:" / "solo", so 5 are left. */
export const OTHER_WORDS = MAX_CUE_WORDS - 1;

export type DetailInput =
  | { field: "start"; pick: string | null; other: string }
  | { field: "ending"; pick: string | null; other: string }
  | { field: "solo"; parts: number[]; who: string }
  | { field: "stop"; parts: number[]; pick: string | null; other: string }
  | { field: "key"; part: number; pick: string | null; other: string };

const known = (picks: readonly (readonly [string, string])[], v: string | null) => (v && picks.some(([c]) => c === v) ? v : null);
function partLine(s: Structure, part: unknown): number {
  if (typeof part !== "number" || !Number.isInteger(part) || !s.parts[part]) throw new Error("Pick a section.");
  return s.parts[part].line;
}
function partList(s: Structure, parts: unknown): number[] {
  if (!Array.isArray(parts) || !parts.length || parts.length > 40) throw new Error("Pick at least one section.");
  return [...new Set(parts)].map((p) => partLine(s, p));
}
const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 200) : "");

/** Write one answer into the chart text. Throws a plain message when the answer can't be used. */
export function applyDetail(text: string, d: DetailInput): string {
  const s = readStructure(text);
  switch (d?.field) {
    case "start": {
      const pick = known(START_PICKS, d.pick);
      return setStart(text, pick ?? `start: ${cleanCue(str(d.other), OTHER_WORDS)}`);
    }
    case "ending": {
      const pick = known(END_PICKS, d.pick);
      return setEnding(text, pick ?? `end: ${cleanCue(str(d.other), OTHER_WORDS)}`);
    }
    case "solo": {
      const who = str(d.who).trim() ? cleanCue(str(d.who), OTHER_WORDS) : "";
      const cue = who ? (/\bsolos?$/i.test(who) ? who : `${who} solo`) : "solo";
      const lines = partList(s, d.parts).filter((line) => !s.solos.some((x) => s.parts[x.part].line === line));
      // later lines first, so earlier line indexes stay right (addCue adds no lines, but be safe)
      return lines.sort((a, b) => b - a).reduce((t, line) => addCue(t, line, cue), text);
    }
    case "stop": {
      const cue = known(STOP_PICKS, d.pick) ?? cleanCue(str(d.other));
      return partList(s, d.parts)
        .sort((a, b) => b - a)
        .reduce((t, line) => addCue(t, line, cue), text);
    }
    case "key": {
      const pick = known(KEY_PICKS, d.pick);
      return setKeyChange(text, partLine(s, d.part), pick ?? str(d.other));
    }
    default:
      throw new Error("Unknown detail.");
  }
}

const stopCount = (s: Structure, i: number) => s.watch.filter((w) => w.part === i && (w.kind === "stop" || w.kind === "cue")).length;
const keyCount = (s: Structure, i: number) => s.watch.filter((w) => w.part === i && w.kind === "key").length;
const hasKeyQ = (s: Structure, i: number) => s.watch.some((w) => w.part === i && w.kind === "keyq");
const isSolo = (s: Structure, i: number) => s.solos.some((x) => x.part === i);

/**
 * Compare the saved chart with the one being saved. Details a player filled in or changed
 * get an ADDED_MARK note; `fields` lists them for the count ("start", "ending",
 * "solo:2", "stop:0", "key:3"; a key question answered "No key change" counts too).
 * Section details are compared section by section only while the number of sections
 * stays the same.
 */
export function markAdded(before: string | null, after: string): { text: string; fields: string[] } {
  const a = readStructure(after);
  let b: Structure | null = null;
  try {
    b = before ? readStructure(before) : null;
  } catch {
    b = null;
  }
  const fields: string[] = [];
  const marks: { part: number; field: MarkField }[] = [];
  const last = a.parts.length - 1;
  if (a.start.cue && a.start.cue !== b?.start.cue) {
    fields.push("start");
    marks.push({ part: 0, field: "start" });
  }
  if (a.ending.cue && a.ending.cue !== b?.ending.cue) {
    fields.push("ending");
    marks.push({ part: last, field: "ending" });
  }
  if (b && b.parts.length === a.parts.length) {
    for (let i = 0; i < a.parts.length; i++) {
      if (isSolo(a, i) && !isSolo(b, i)) {
        fields.push(`solo:${i}`);
        marks.push({ part: i, field: "solo" });
      }
      if (stopCount(a, i) > stopCount(b, i)) {
        fields.push(`stop:${i}`);
        marks.push({ part: i, field: "stop" });
      }
      if (keyCount(a, i) > keyCount(b, i)) {
        fields.push(`key:${i}`);
        marks.push({ part: i, field: "key" });
      } else if (hasKeyQ(b, i) && !hasKeyQ(a, i)) fields.push(`key:${i}`);
    }
  }
  return { text: addMarks(after, marks), fields };
}

/** Which "+ Add…" prompts a chart has (for the owner's screens). */
export function openDetails(s: Structure) {
  return {
    start: !s.start.cue,
    ending: !s.ending.cue,
    solo: !s.hasSolo,
    stop: !s.hasStops,
    key: s.watch.filter((w) => w.kind === "keyq").map((w) => w.part),
  };
}
