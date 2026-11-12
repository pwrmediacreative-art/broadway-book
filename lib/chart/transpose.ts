import type { BeatItem, ChordItem, Degree, NumberStyle } from "./types";

const LETTERS = "CDEFGAB";
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const mod = (n: number, m: number) => ((n % m) + m) % m;
const accValue = (a: string) => (a === "b" ? -1 : a === "#" ? 1 : 0);

export interface Key {
  letter: number; // 0-6 index into CDEFGAB
  pc: number; // pitch class 0-11
  minor: boolean;
}

/** "A", "Bb", "F#", "Am", "C#m" */
export function parseKey(s: string): Key | null {
  const m = /^([A-G])([b#]?)(m?)$/.exec(s.trim());
  if (!m) return null;
  const letter = LETTERS.indexOf(m[1]);
  return { letter, pc: mod(LETTER_PC[letter] + accValue(m[2]), 12), minor: m[3] === "m" };
}

/** Spell pitch class `pc` using letter `letter`, falling back to a simpler name. */
function spell(letter: number, pc: number): string {
  const diff = mod(pc - LETTER_PC[letter] + 6, 12) - 6;
  if (diff === 0) return LETTERS[letter];
  if (diff === 1) return LETTERS[letter] + "#";
  if (diff === -1) return LETTERS[letter] + "b";
  // double sharp/flat: use the neighbouring letter instead
  return spell(mod(letter + (diff > 0 ? 1 : -1), 7), pc);
}

export function keyName(k: Key): string {
  return spell(k.letter, k.pc) + (k.minor ? "m" : "");
}

/** "A minor", "Bb major". */
export function keyLongName(k: Key): string {
  return spell(k.letter, k.pc) + (k.minor ? " minor" : " major");
}

/** The other key with the same notes: Am <-> C, F#m <-> A, Bb <-> Gm, Ebm <-> Gb. */
export function relativeKey(k: Key): Key {
  return k.minor
    ? { letter: mod(k.letter + 2, 7), pc: mod(k.pc + 3, 12), minor: false }
    : { letter: mod(k.letter + 5, 7), pc: mod(k.pc + 9, 12), minor: true };
}

/** The key the numbers count from: a minor song numbered "relative" counts from its relative major. */
export function numberingKey(key: Key, style: NumberStyle): Key {
  return key.minor && style === "relative" ? relativeKey(key) : key;
}

/**
 * Key as players should read it for the current numbering view, numbering key first.
 * Am parallel: "A minor (relative to C major)". Am relative: "C major (relative to A minor)".
 * Major songs: just "E major".
 */
export function keyPairLabel(key: Key, style: NumberStyle): string {
  if (!key.minor) return keyLongName(key);
  const home = numberingKey(key, style);
  return `${keyLongName(home)} (relative to ${keyLongName(relativeKey(home))})`;
}

/** Short form for tight spots and the key picker: "Am (C)" / "C (Am)". */
export function keyPairShort(key: Key, style: NumberStyle): string {
  if (!key.minor) return keyName(key);
  const home = numberingKey(key, style);
  return `${keyName(home)} (${keyName(relativeKey(home))})`;
}

/** The note that "1" stands for under a numbering style. */
function reference(key: Key, style: NumberStyle): { letter: number; pc: number } {
  return numberingKey(key, style);
}

/** Degree + key -> note name. A key: 1=A, 4=D. F key: 4=Bb. E key: b7=D. */
export function degreeToNote(d: Degree, key: Key, style: NumberStyle = "minor"): string {
  const ref = reference(key, style);
  const letter = mod(ref.letter + d.degree - 1, 7);
  return spell(letter, mod(ref.pc + MAJOR[d.degree - 1] + accValue(d.acc), 12));
}

export function qualityName(q: string): string {
  return q.startsWith("-") ? "m" + q.slice(1) : q;
}

/** Chord name for a chord, e.g. 6- in A -> F#m, 1/3 in A -> A/C#. */
export function chordName(c: ChordItem, key: Key, style: NumberStyle = "minor"): string {
  let name = degreeToNote(c.root, key, style) + qualityName(c.quality);
  if (c.bass) name += "/" + degreeToNote(c.bass, key, style);
  return name;
}

/**
 * Move a degree between minor-key numbering styles.
 * "minor": 1 = minor tonic (Am: Am=1-, C=b3).  "relative": 1 = relative major (Am: Am=6-, C=1).
 */
export function renumberDegree(d: Degree, from: NumberStyle, to: NumberStyle): Degree {
  if (from === to) return d;
  const letterShift = from === "minor" ? -2 : 2;
  const semiShift = from === "minor" ? -3 : 3;
  const idx = mod(d.degree - 1 + letterShift, 7);
  const offset = mod(MAJOR[d.degree - 1] + accValue(d.acc) + semiShift, 12);
  const diff = mod(offset - MAJOR[idx] + 6, 12) - 6;
  if (diff >= -1 && diff <= 1) {
    return { degree: idx + 1, acc: diff === -1 ? "b" : diff === 1 ? "#" : "" };
  }
  // Rare double accidental: pick the nearest natural/flat degree instead.
  for (const [i, pc] of MAJOR.entries()) {
    if (pc === offset) return { degree: i + 1, acc: "" };
    if (pc - 1 === offset) return { degree: i + 1, acc: "b" };
  }
  return d;
}

export function renumberBeat(b: BeatItem, from: NumberStyle, to: NumberStyle): BeatItem {
  if (b.kind !== "chord" || from === to) return b;
  return {
    ...b,
    root: renumberDegree(b.root, from, to),
    bass: b.bass ? renumberDegree(b.bass, from, to) : null,
  };
}

const MAJOR_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MINOR_NAMES = ["Cm", "C#m", "Dm", "Ebm", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "Bbm", "Bm"];

/** The 12 keys players normally call, in the same mode as `minor`. */
export function keyChoices(minor: boolean): string[] {
  return minor ? MINOR_NAMES : MAJOR_NAMES;
}

/** Common spelling for a pitch class + mode. */
export function commonKey(pc: number, minor: boolean): Key {
  return parseKey(keyChoices(minor)[mod(pc, 12)])!;
}

export function shiftKey(k: Key, semitones: number): Key {
  return commonKey(k.pc + semitones, k.minor);
}

/**
 * Key picker entries for a song in `original`'s mode, labelled for the numbering view.
 * Values are always keys in the song's own mode (so picking "D (Bm)" sets the song to Bm);
 * the song's own key keeps its chart spelling. Relative view is ordered by the major key.
 */
export function keyPickerOptions(original: Key, style: NumberStyle): { value: string; label: string; pc: number }[] {
  const rel = original.minor && style === "relative";
  return MAJOR_NAMES.map((_, i) => {
    let k: Key;
    if (rel) {
      k = relativeKey(parseKey(MAJOR_NAMES[i])!); // C -> Am, Db -> Bbm, F# -> D#m
    } else {
      k = parseKey(keyChoices(original.minor)[i])!;
    }
    if (k.pc === original.pc) k = original;
    return { value: keyName(k), label: keyPairShort(k, style), pc: k.pc };
  });
}
