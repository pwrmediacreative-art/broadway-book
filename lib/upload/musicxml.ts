// Reads chord symbols out of a MusicXML file (Moises AI Studio, MuseScore, Guitar Pro...)
// into a Timeline. Only <harmony> chord symbols, key, time, tempo and bar lengths are read.
// Notes and <lyric> elements are never looked at, so lyrics can't get into a chart.
import type { Timeline, TimelineBar, TimelineChord } from "./timeline";

export class MusicXmlError extends Error {}

export const MAX_MUSICXML_BYTES = 2 * 1024 * 1024;

const STEP_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const mod12 = (n: number) => ((n % 12) + 12) % 12;

/** MusicXML <kind> → our chart quality. `dropped` = what we couldn't write. */
const KINDS: Record<string, { q: string; dropped?: string }> = {
  major: { q: "" },
  minor: { q: "-" },
  augmented: { q: "+" },
  diminished: { q: "dim" },
  dominant: { q: "7" },
  "major-seventh": { q: "maj7" },
  "minor-seventh": { q: "-7" },
  "diminished-seventh": { q: "dim7" },
  "augmented-seventh": { q: "+7" },
  "half-diminished": { q: "-7b5" },
  "major-minor": { q: "-maj7" },
  "major-sixth": { q: "6" },
  "minor-sixth": { q: "-6" },
  "dominant-ninth": { q: "9" },
  "major-ninth": { q: "maj9" },
  "minor-ninth": { q: "-9" },
  "dominant-11th": { q: "11" },
  "major-11th": { q: "maj9", dropped: "11th" },
  "minor-11th": { q: "-11" },
  "dominant-13th": { q: "13" },
  "major-13th": { q: "maj9", dropped: "13th" },
  "minor-13th": { q: "-13" },
  "suspended-second": { q: "sus2" },
  "suspended-fourth": { q: "sus4" },
  power: { q: "", dropped: "power chord (no 3rd)" },
};

const tag = (xml: string, name: string) => new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml)?.[1]?.trim();
const num = (s: string | undefined) => (s === undefined || s === "" || isNaN(Number(s)) ? undefined : Number(s));
const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function keyFrom(fifths: number, mode: string | undefined): { pc: number; minor: boolean } {
  const majorPc = mod12(fifths * 7);
  const minor = mode === "minor";
  return { pc: minor ? mod12(majorPc + 9) : majorPc, minor };
}

function readHarmony(xml: string): Omit<TimelineChord, "beat"> & { offset: number } {
  const offset = num(tag(xml, "offset")) ?? 0;
  const kindRaw = (tag(xml, "kind") ?? "major").trim();
  if (kindRaw === "none") return { root: null, quality: "", bass: null, offset };
  const step = tag(xml, "root-step");
  if (!step || !(step in STEP_PC)) return { root: null, quality: "", bass: null, offset, dropped: "unreadable chord" };
  const root = mod12(STEP_PC[step] + (num(tag(xml, "root-alter")) ?? 0));
  const kind = KINDS[kindRaw] ?? { q: "", dropped: `chord type "${kindRaw}"` };
  const bassStep = tag(xml, "bass-step");
  const bass = bassStep && bassStep in STEP_PC ? mod12(STEP_PC[bassStep] + (num(tag(xml, "bass-alter")) ?? 0)) : null;
  const dropped = [kind.dropped, /<degree[\s>]/.test(xml) ? "added/altered notes" : undefined].filter(Boolean).join(", ");
  return { root, quality: kind.q, bass: bass === root ? null : bass, offset, ...(dropped ? { dropped } : {}) };
}

/** Parse MusicXML text (partwise) into a chord timeline. */
export function readMusicXml(text: string): Timeline {
  if (text.length > MAX_MUSICXML_BYTES) throw new MusicXmlError("That file is over 2 MB.");
  if (/<score-timewise[\s>]/.test(text))
    throw new MusicXmlError("This MusicXML layout (timewise) isn't supported. Export it again as standard MusicXML.");
  if (!/<score-partwise[\s>]/.test(text)) throw new MusicXmlError("That doesn't look like a MusicXML file.");

  const parts = [...text.matchAll(/<part\s[^>]*>([\s\S]*?)<\/part>/g)].map((m) => m[1]);
  const part = parts.find((p) => /<harmony[\s>]/.test(p));
  if (!part) throw new MusicXmlError("No chord symbols found in this file. Export a chord chart (with chord names).");

  const title = (() => {
    const t = tag(text, "work-title") ?? tag(text, "movement-title");
    return t ? decode(t).slice(0, 200) : null;
  })();

  let divisions = 1;
  let beats = 4;
  let unit = 4;
  let key: Timeline["key"] = null;
  let bpm: number | null = null;
  const bars: TimelineBar[] = [];

  for (const m of part.matchAll(/<measure\b[^>]*>([\s\S]*?)<\/measure>/g)) {
    const body = m[1];
    const bar: TimelineBar = { beats, chords: [] };
    let pos = 0; // in divisions
    // Walk the measure's children in order.
    for (const el of body.matchAll(
      /<(attributes|note|backup|forward|harmony|direction|sound)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g,
    )) {
      const [, name, attrs, inner = ""] = el;
      if (name === "attributes") {
        divisions = num(tag(inner, "divisions")) ?? divisions;
        const b = num(tag(inner, "beats"));
        const u = num(tag(inner, "beat-type"));
        if (b && u) {
          beats = b;
          unit = u;
          bar.beats = b;
        }
        const fifths = num(tag(inner, "fifths"));
        if (fifths !== undefined) {
          const k = keyFrom(fifths, tag(inner, "mode"));
          if (!key) key = k;
          else if (k.pc !== key.pc || k.minor !== key.minor) bar.key = k;
          if (bars.length === 0) key = k;
        }
      } else if (name === "note") {
        if (!/<chord\s*\/>/.test(inner) && !/<grace[\s/>]/.test(inner)) pos += num(tag(inner, "duration")) ?? 0;
      } else if (name === "backup") {
        pos -= num(tag(inner, "duration")) ?? 0;
      } else if (name === "forward") {
        pos += num(tag(inner, "duration")) ?? 0;
      } else if (name === "harmony") {
        const h = readHarmony(inner);
        const beatLen = (divisions * 4) / unit;
        const { offset, ...chord } = h;
        bar.chords.push({ ...chord, beat: Math.max(0, (pos + offset) / beatLen) });
      } else {
        const t = num(/tempo="([\d.]+)"/.exec(name === "sound" ? attrs : inner)?.[1]) ??
          num(tag(inner, "per-minute"));
        if (t && t >= 20 && t <= 400) {
          if (bpm === null) bpm = Math.round(t);
          else bar.tempo = Math.round(t);
        }
      }
    }
    bar.chords.sort((a, b) => a.beat - b.beat);
    bars.push(bar);
  }
  if (!bars.length) throw new MusicXmlError("No bars found in this file.");
  return { version: 1, source: "musicxml", title, key, bpm, time: { beats, unit }, bars };
}
