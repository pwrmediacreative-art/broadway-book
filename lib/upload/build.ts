// Turns a chord Timeline into a Broadway Book chart (docs/CHART_FORMAT.md).
// Honest by design: anything the source doesn't tell us for sure gets a
// "# UNCLEAR: <section> bar <n>: <what>" note (same marker as the AI reading step) and
// counts against the confidence score. Never writes lyrics: only numbers, section labels
// and fixed short cue words.
import { checkChart } from "../chart/validate";
import { commonKey, keyName } from "../chart/transpose";
import type { Timeline, TimelineChord } from "./timeline";

const DEGREES = ["1", "b2", "2", "b3", "3", "4", "b5", "5", "b6", "6", "b7", "7"];
const MAJOR_SCALE = new Set([0, 2, 4, 5, 7, 9, 11]);
const MINOR_SCALE = new Set([0, 2, 3, 5, 7, 8, 10, 11]); // natural minor + the 5 chord's 3rd
const mod12 = (n: number) => ((n % 12) + 12) % 12;
const ROW = 4; // bars per chart line

export interface BuildResult {
  text: string; // canonical chart text (parses)
  confidence: number; // share of bars with nothing unclear, 0–1
  estimated: boolean; // true: worked out from timing signals, not from source confidence
  unclear: string[]; // the UNCLEAR notes, as written
  key: string;
  bpm: number | null;
  time: string;
  simplified: boolean; // second try: chord types simplified so the chart parses
}

export class BuildError extends Error {}

interface Bar {
  token: string; // chart text for the whole bar
  main: string; // the chord that fills most of the bar (used to spot repeats)
  notes: string[]; // unclear notes for this bar
  nc: boolean;
  roots: (number | null)[];
  keyTag?: string; // {key: X} before this bar
  tempo?: number;
}

function chordToken(c: TimelineChord | null, keyPc: number, simplify: boolean): string {
  if (!c || c.root === null) return "NC";
  const iv = mod12(c.root - keyPc);
  let q = c.quality;
  if (simplify) q = q.startsWith("-") ? "-" : q.startsWith("dim") ? "dim" : "";
  const deg = iv === 6 && q.startsWith("dim") ? "#4" : DEGREES[iv];
  const bass = c.bass === null ? "" : `/${DEGREES[mod12(c.bass - keyPc)]}`;
  return `${deg}${q}${bass}`;
}

const sameChord = (a: TimelineChord | null, b: TimelineChord | null) =>
  a === b || (!!a && !!b && a.root === b.root && a.quality === b.quality && a.bass === b.bass);

function similar(a: Bar[], b: Bar[]): boolean {
  if (!a.length || !b.length) return false;
  const n = Math.max(a.length, b.length);
  let same = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i].main === b[i].main) same++;
  return same / n >= 0.75;
}

const identical = (a: Bar[], b: Bar[]) => a.length === b.length && a.every((x, i) => x.token === b[i].token);

/** Bars of chart text plus their unclear notes. Leading bars with no chord are counted, not written. */
function cutBars(tl: Timeline, keyPc: number, simplify: boolean): { bars: Bar[]; leadIn: number; dropped: Set<string> } {
  const bars: Bar[] = [];
  const dropped = new Set<string>();
  let current: TimelineChord | null = null;
  let started = false;
  let leadIn = 0;
  let carry: TimelineChord | null = null; // a change that snapped onto the next downbeat

  for (const src of tl.bars) {
    const n = Math.max(1, Math.round(src.beats));
    const slots: (TimelineChord | null)[] = new Array(n).fill(undefined);
    const notes: string[] = [];
    if (carry) {
      slots[0] = carry;
      carry = null;
    }
    for (const c of src.chords) {
      const snap = Math.round(c.beat);
      if (Math.abs(c.beat - snap) > 0.15) notes.push(`${chordToken(c, keyPc, simplify)} changes between beats`);
      if (c.dropped) {
        notes.push(`${chordToken(c, keyPc, simplify)}: left out ${c.dropped}`);
        dropped.add(c.dropped);
      }
      if (c.confidence !== undefined && c.confidence < 0.6) notes.push(`${chordToken(c, keyPc, simplify)} is a low-confidence reading`);
      if (snap >= n) {
        carry = c;
        notes.push(`${chordToken(c, keyPc, simplify)} lands just before the next bar (push?)`);
        continue;
      }
      if (slots[snap] !== undefined && slots[snap] !== null && !sameChord(slots[snap], c))
        notes.push(`${chordToken(slots[snap], keyPc, simplify)} is shorter than a beat and was left out`);
      slots[snap] = c;
    }
    // fill held chords
    for (let i = 0; i < n; i++) {
      if (slots[i] === undefined) slots[i] = current;
      else current = slots[i];
    }
    if (!started) {
      if (slots.every((s) => s === null || s === undefined)) {
        leadIn++;
        continue;
      }
      started = true;
      // the first chord fills the beats before it in the first real bar
      const first = slots.find((s) => s) ?? null;
      for (let i = 0; i < n && !slots[i]; i++) slots[i] = first;
    }
    const tokens = slots.map((s) => chordToken(s ?? null, keyPc, simplify));
    let token: string;
    const distinct = new Set(tokens);
    if (distinct.size === 1) token = tokens[0];
    else if (n % 2 === 0 && new Set(tokens.slice(0, n / 2)).size === 1 && new Set(tokens.slice(n / 2)).size === 1)
      token = `(${tokens[0]} ${tokens[n / 2]})`;
    else token = `(${tokens.join(" ")})`;
    if (n === 4)
      for (const i of [1, 3]) if (tokens[i] !== tokens[i - 1]) notes.push(`change on beat ${i + 1}`);
    if (distinct.size > 2) notes.push("busy bar, more than 2 chords");
    const nc = tokens.includes("NC");
    if (nc) notes.push("no chord here: stop or break?");
    const counts = new Map<string, number>();
    for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
    const main = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const bar: Bar = { token, main, notes: [...new Set(notes)], nc, roots: slots.map((s) => s?.root ?? null) };
    if (src.key) bar.keyTag = keyName(commonKey(src.key.pc, src.key.minor));
    if (src.tempo) bar.tempo = src.tempo;
    bars.push(bar);
  }
  return { bars, leadIn, dropped };
}

interface Section {
  name: string; // Intro, V, C, B, Outro...
  number: number | null;
  repeat: number | null;
  bars: Bar[];
  group: number;
}

/**
 * Propose sections from repeating chord patterns:
 * 1. cut the song into 4-bar phrases and group phrases that share 3 of 4 main chords;
 * 2. phrase groups that follow each other at least twice belong to one section type
 *    (a chorus is often phrase X then phrase Y, twice);
 * 3. a run of phrases of one section type is one section (16 bars at most);
 * 4. the first section type that comes back is V, the next C; one-off parts are Intro
 *    (at the start), Outro (at the end) or B.
 * Every label is a guess, so each one gets flagged.
 */
function proposeSections(bars: Bar[]): Section[] {
  const phrases: Bar[][] = [];
  for (let i = 0; i < bars.length; i += ROW) phrases.push(bars.slice(i, i + ROW));
  const reps: Bar[][] = [];
  const cluster = phrases.map((p) => {
    let c = reps.findIndex((r) => r.length === p.length && similar(r, p));
    if (c < 0) {
      reps.push(p);
      c = reps.length - 1;
    }
    return c;
  });
  // units: two phrases that come back together (a chorus is often phrase X then Y) make
  // one 8-bar unit; otherwise a phrase stands alone
  const pairCount = new Map<string, number>();
  for (let i = 0; i + 1 < cluster.length; i++) {
    const k = `${cluster[i]}+${cluster[i + 1]}`;
    pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
  }
  const units: { key: string; phrases: Bar[][] }[] = [];
  for (let i = 0; i < phrases.length; ) {
    const pc = (j: number) => (j + 1 < phrases.length ? (pairCount.get(`${cluster[j]}+${cluster[j + 1]}`) ?? 0) : 0);
    const k = `${cluster[i]}+${cluster[i + 1]}`;
    // pair here unless the pair starting one phrase later comes back more often
    if (pc(i) >= 2 && pc(i) >= pc(i + 1)) {
      units.push({ key: k, phrases: [phrases[i], phrases[i + 1]] });
      i += 2;
    } else {
      units.push({ key: `${cluster[i]}`, phrases: [phrases[i]] });
      i += 1;
    }
  }
  // runs of the same unit, at most 16 bars each
  type Run = { fam: number; phrases: Bar[][] };
  const famIds = new Map<string, number>();
  const runs: Run[] = [];
  for (const u of units) {
    if (!famIds.has(u.key)) famIds.set(u.key, famIds.size);
    const f = famIds.get(u.key)!;
    const last = runs[runs.length - 1];
    if (last && last.fam === f && last.phrases.length + u.phrases.length <= 4) last.phrases.push(...u.phrases);
    else runs.push({ fam: f, phrases: [...u.phrases] });
  }
  const famRuns = (f: number) => runs.filter((r) => r.fam === f).length;
  const famBars = (f: number) => runs.filter((r) => r.fam === f).reduce((n, r) => n + r.phrases.length * ROW, 0);
  const repeated: number[] = [];
  // a part repeats when its unit comes back, in a row or later
  const famUnits = (f: number) => units.filter((u) => famIds.get(u.key) === f).length;
  for (const r of runs) if (famUnits(r.fam) > 1 && !repeated.includes(r.fam)) repeated.push(r.fam);
  // C: the repeated part played the most; V: the first other repeated part; Pre: a part
  // that leads into C most times; anything else that repeats: Turn.
  const label = new Map<number, string>();
  const chorus = [...repeated].sort((x, y) => famBars(y) - famBars(x) || repeated.indexOf(y) - repeated.indexOf(x))[0];
  if (chorus !== undefined) label.set(chorus, "C");
  const verse = repeated.find((f) => f !== chorus);
  if (verse !== undefined) label.set(verse, "V");
  for (const f of repeated) {
    if (label.has(f)) continue;
    const before = runs.filter((r, i) => r.fam === f && runs[i + 1]?.fam === chorus).length;
    label.set(f, before * 2 >= famRuns(f) ? "Pre" : "Turn");
  }
  const sections: Section[] = [];
  const seen = new Map<string, number>();
  runs.forEach((r, i) => {
    let name: string;
    if (label.has(r.fam)) name = label.get(r.fam)!;
    else if (i === 0 && runs.length > 1) name = "Intro";
    else if (i === runs.length - 1 && runs.length > 1) name = "Outro";
    else name = "B";
    // play-twice: the run is the same half twice
    let body = r.phrases.flat();
    let repeat: number | null = null;
    const half = body.length / 2;
    if (r.phrases.length % 2 === 0 && identical(body.slice(0, half), body.slice(half))) {
      body = body.slice(0, half);
      repeat = 2;
    }
    const prev = sections[sections.length - 1];
    if (prev && prev.group === r.fam && prev.repeat && identical(prev.bars, body)) {
      prev.repeat += repeat ?? 1;
      return;
    }
    // a Turn straight after a verse is the rest of that verse; one-off parts in a row are one B
    if (prev && !prev.repeat && !repeat &&
        ((name === "Turn" && prev.name === "V") || (name === "B" && prev.name === "B")) &&
        prev.bars.length + body.length <= 16) {
      prev.bars = [...prev.bars, ...body];
      return;
    }
    sections.push({ name, number: null, repeat, bars: body, group: r.fam });
  });
  for (const sec of sections) {
    const n = (seen.get(sec.name) ?? 0) + 1;
    seen.set(sec.name, n);
    sec.number = n > 1 ? n : null;
  }
  return sections;
}

function outOfKey(bars: Bar[], minor: boolean, keyPc: number): number {
  const scale = minor ? MINOR_SCALE : MAJOR_SCALE;
  let out = 0;
  for (const b of bars) for (const r of new Set(b.roots)) if (r !== null && !scale.has(mod12(r - keyPc))) out++;
  return out;
}

function guessKey(tl: Timeline): { pc: number; minor: boolean } {
  // Only used when the file has no key: count chord roots in each major scale.
  let best = { pc: 0, minor: false, score: -1 };
  for (let pc = 0; pc < 12; pc++) {
    let score = 0;
    for (const b of tl.bars) for (const c of b.chords) if (c.root !== null && MAJOR_SCALE.has(mod12(c.root - pc))) score++;
    if (score > best.score) best = { pc, minor: false, score };
  }
  return best;
}

function render(tl: Timeline, opts: { title: string; artist?: string | null }, simplify: boolean) {
  const keyKnown = !!tl.key;
  const k = tl.key ?? guessKey(tl);
  const keyStr = keyName(commonKey(k.pc, k.minor));
  const time = `${tl.time.beats}/${tl.time.unit}`;
  const { bars, leadIn, dropped } = cutBars(tl, k.pc, simplify);
  if (!bars.length) throw new BuildError("No chords found in this file.");

  const header: string[] = [];
  const top: string[] = [];
  header.push(`{title: ${opts.title.replace(/[{}]/g, "").trim()}}`);
  if (opts.artist?.trim()) header.push(`{artist: ${opts.artist.replace(/[{}]/g, "").trim()}}`);
  header.push(`{key: ${keyStr}}${tl.bpm ? ` {bpm: ${tl.bpm}}` : ""} {time: ${time}}`);

  const unclear: string[] = [];
  const note = (s: string) => {
    unclear.push(s);
    return `# UNCLEAR: ${s}`;
  };
  if (!keyKnown) top.push(note("key: the file has no key, worked out from the chords"));
  else {
    const out = outOfKey(bars, k.minor, k.pc);
    const total = bars.reduce((n, b) => n + new Set(b.roots.filter((r) => r !== null)).size, 0);
    if (total && out / total > 0.3) top.push(note(`key: ${Math.round((out / total) * 100)}% of chords don't fit ${keyStr}, check the key`));
  }
  if (!tl.bpm) top.push(note("tempo: the file has no BPM"));
  if (leadIn > 0)
    top.push(note(`start: ${leadIn} bar${leadIn > 1 ? "s" : ""} before the first chord: count-off or drum intro?`));
  else top.push(note("start: how the song starts isn't in the file, check by ear"));
  if (simplify) top.push(note("chords: simplified to plain major/minor so the chart could be read"));
  if (dropped.size) top.push(note(`chords: left out ${[...dropped].join(", ")} where the chart format can't show it`));

  const sections = proposeSections(bars);
  const body: string[] = [];
  let unclearBars = 0;
  let totalBars = 0;
  sections.forEach((s, si) => {
    const label = `${s.name}${s.number ?? ""}`;
    const notes: string[] = [note(`${label}: label from repeat pattern`)];
    if (outOfKey(s.bars, k.minor, k.pc) >= 3) notes.push(note(`${label}: possible key change`));
    s.bars.forEach((b, i) => {
      for (const n of b.notes) notes.push(note(`${label} bar ${i + 1}: ${n}`));
    });
    const reps = s.repeat ?? 1;
    totalBars += s.bars.length * reps;
    unclearBars += s.bars.filter((b) => b.notes.length).length * reps;
    const items = s.bars.map((b) => `${b.keyTag ? `{key: ${b.keyTag}} ` : ""}${b.token}`);
    const last = si === sections.length - 1;
    // Ritard: a slower tempo marking in the last 4 bars of the song (measured, not guessed).
    if (last) {
      const slow = s.bars.slice(-4).some((b) => b.tempo && tl.bpm && b.tempo < tl.bpm * 0.9);
      if (slow) items[items.length - 1] = `"ritard" ${items[items.length - 1]}`;
      else notes.push(note("ending: cold stop, fade, ritard or tag? check by ear"));
    }
    const rows: string[] = [];
    for (let i = 0; i < items.length; i += ROW) rows.push(items.slice(i, i + ROW).join(" "));
    body.push(...notes, `[${label}${s.repeat ? ` x${s.repeat}` : ""}] ${rows.join(" | ")}`);
  });

  const text = [...header, ...top, ...body].join("\n") + "\n";
  const confidence = totalBars ? Math.round(((totalBars - unclearBars) / totalBars) * 100) / 100 : 0;
  return { text, confidence, unclear, key: keyStr, time };
}

/** Build a chart from a timeline. Tries once as read, once with chord types simplified. */
export function buildChart(tl: Timeline, opts: { title: string; artist?: string | null }): BuildResult {
  if (!opts.title?.trim()) throw new BuildError("Give the song a title.");
  let lastError = "";
  for (const simplify of [false, true]) {
    const r = render(tl, opts, simplify);
    const check = checkChart(r.text);
    if (check.ok && check.canonical) {
      const estimated = !tl.bars.some((b) => b.chords.some((c) => c.confidence !== undefined));
      return {
        text: check.canonical,
        confidence: r.confidence,
        estimated,
        unclear: r.unclear,
        key: r.key,
        bpm: tl.bpm,
        time: r.time,
        simplified: simplify,
      };
    }
    lastError = check.error ?? check.longCues.join(", ");
  }
  throw new BuildError(`We couldn't turn this file into a chart (${lastError}). Try exporting it again.`);
}
