import { describe, expect, it } from "vitest";
import { parseChart } from "../chart/parse";
import { serializeChart } from "../chart/serialize";
import { readMusicXml, MusicXmlError } from "./musicxml";
import { buildChart } from "./build";
import { addCue, readStructure, renamePart, sectionStartBars, setEnding, setRepeat, setStart } from "./structure";

const harmony = (step: string, kind = "major", extra = "") =>
  `<harmony><root><root-step>${step}</root-step></root><kind>${kind}</kind>${extra}</harmony>`;
const rest = (beats = 4) => `<note><rest/><duration>${beats * 24}</duration><lyric><text>la la secret words</text></lyric></note>`;
const bar = (n: number, chords: string, first = "") => `<measure number="${n}">${first}${chords}${rest()}</measure>`;

/** 8-bar verse twice, 8-bar chorus twice. Key G, 100 bpm. */
function songXml(): string {
  const attrs = `<attributes><divisions>24</divisions><key><fifths>1</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    <direction><direction-type><metronome><per-minute>100</per-minute></metronome></direction-type><sound tempo="100"/></direction>`;
  const verse = ["G", "C", "G", "D", "G", "C", "D", "G"];
  const chorus = ["C", "C", "G", "G", "C", "C", "D", "D"];
  const all = [...verse, ...verse, ...chorus, ...chorus];
  const measures = all.map((s, i) => bar(i + 1, harmony(s), i === 0 ? attrs : ""));
  return `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>Test &amp; Song</work-title></work>
    <part-list><score-part id="P1"><part-name>Chords</part-name></score-part></part-list>
    <part id="P1">${measures.join("")}</part></score-partwise>`;
}

describe("readMusicXml", () => {
  it("reads key, tempo, time, title and one chord per bar", () => {
    const tl = readMusicXml(songXml());
    expect(tl.title).toBe("Test & Song");
    expect(tl.key).toEqual({ pc: 7, minor: false });
    expect(tl.bpm).toBe(100);
    expect(tl.time).toEqual({ beats: 4, unit: 4 });
    expect(tl.bars).toHaveLength(32);
    expect(tl.bars[1].chords[0]).toMatchObject({ beat: 0, root: 0, quality: "" });
  });

  it("reads offsets, minor, 7ths, slash bass and no-chord", () => {
    const m = `<measure number="1"><attributes><divisions>2</divisions><key><fifths>0</fifths><mode>minor</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      ${harmony("A", "minor")}<note><rest/><duration>4</duration></note>
      ${harmony("E", "dominant", "<bass><bass-step>G</bass-step><bass-alter>1</bass-alter></bass>")}<note><rest/><duration>2</duration></note>
      <harmony><kind>none</kind></harmony><note><rest/><duration>2</duration></note></measure>`;
    const tl = readMusicXml(`<score-partwise><part id="P1">${m}</part></score-partwise>`);
    expect(tl.key).toEqual({ pc: 9, minor: true });
    expect(tl.bars[0].chords).toEqual([
      { beat: 0, root: 9, quality: "-", bass: null },
      { beat: 2, root: 4, quality: "7", bass: 8 },
      { beat: 3, root: null, quality: "", bass: null },
    ]);
  });

  it("refuses files that aren't chord charts", () => {
    expect(() => readMusicXml("<html></html>")).toThrow(MusicXmlError);
    expect(() => readMusicXml('<score-partwise><part id="P1"><measure number="1"><note/></measure></part></score-partwise>')).toThrow(/No chord symbols/);
  });
});

describe("buildChart", () => {
  it("writes a chart that parses and round-trips, with numbers and sections", () => {
    const r = buildChart(readMusicXml(songXml()), { title: "Test Song", artist: "Band" });
    expect(serializeChart(parseChart(r.text).doc)).toBe(r.text);
    expect(r.text).toContain("{key: G} {bpm: 100} {time: 4/4}");
    expect(r.text).toContain("[V x2] 1 4 1 5 | 1 4 5 1");
    expect(r.text).toContain("[C x2] 4 4 1 1 | 4 4 5 5");
    expect(r.key).toBe("G");
    expect(r.estimated).toBe(true);
  });

  it("never carries words from the file into the chart", () => {
    const r = buildChart(readMusicXml(songXml()), { title: "Test Song" });
    expect(r.text).not.toMatch(/secret|la la/);
  });

  it("flags guessed labels, the start and the ending as UNCLEAR", () => {
    const r = buildChart(readMusicXml(songXml()), { title: "Test Song" });
    expect(r.text).toContain("# UNCLEAR: V: label from repeat pattern");
    expect(r.text).toMatch(/# UNCLEAR: start: /);
    expect(r.text).toMatch(/# UNCLEAR: ending: /);
    expect(r.confidence).toBe(1); // every bar is clean
  });

  it("splits bars on the beat and flags weak-beat changes", () => {
    const xml = `<score-partwise><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      ${harmony("C")}<note><rest/><duration>2</duration></note>${harmony("F")}<note><rest/><duration>2</duration></note></measure>
      <measure number="2">${harmony("C")}<note><rest/><duration>3</duration></note>${harmony("G")}<note><rest/><duration>1</duration></note></measure>
    </part></score-partwise>`;
    const r = buildChart(readMusicXml(xml), { title: "Splits" });
    expect(r.text).toContain("(1 4) (1 1 1 5)");
    expect(r.text).toMatch(/bar 2: change on beat 4/);
    expect(r.confidence).toBe(0.5);
  });

  it("counts bars before the first chord instead of writing them", () => {
    const xml = songXml().replace(
      /(<measure number="1">)(<attributes>[\s\S]*?<\/direction>)/,
      `<measure number="0">$2${rest()}</measure>$1`,
    );
    const r = buildChart(readMusicXml(xml), { title: "Lead in" });
    expect(r.text).toContain("# UNCLEAR: start: 1 bar before the first chord");
  });
});

describe("structure card", () => {
  const chart = () => buildChart(readMusicXml(songXml()), { title: "Test Song" }).text;

  it("reads the form line and the unclear start / ending", () => {
    const s = readStructure(chart());
    expect(s.formLine).toBe("V 8 x2 · C 8 x2");
    expect(s.parts.map((p) => p.guessed)).toEqual([true, true]);
    expect(s.start.unclear).toBeTruthy();
    expect(s.ending.unclear).toBeTruthy();
  });

  it("edits write back into the chart text and clear the matching flags", () => {
    let t = chart();
    t = setStart(t, "count off");
    t = setEnding(t, "cold stop");
    t = renamePart(t, readStructure(t).parts[0].line, "V", null);
    t = setRepeat(t, readStructure(t).parts[1].line, 3);
    t = addCue(t, readStructure(t).parts[1].line, "band out");
    expect(serializeChart(parseChart(t).doc)).toBe(t);
    const after = readStructure(t);
    expect(after.start).toEqual({ cue: "count off", unclear: null, byPlayer: false });
    expect(after.ending).toEqual({ cue: "cold stop", unclear: null, byPlayer: false });
    expect(after.parts[0].guessed).toBe(false);
    expect(after.formLine).toBe("V 8 x2 · C 8 x3 cold stop");
    expect(after.watch.map((w) => w.text)).toContain("“band out” in C");
    expect(t).toContain('[V x2] "count off" 1 4 1 5');
  });

  it("refuses long cues (never lyrics)", () => {
    expect(() => addCue(chart(), readStructure(chart()).parts[0].line, "one two three four five six seven")).toThrow(/6 words/);
  });

  it("knows where each section starts, counting repeats", () => {
    expect(sectionStartBars(chart()).map((s) => [s.label, s.bar, s.bars])).toEqual([
      ["V", 0, 16],
      ["C", 16, 16],
    ]);
  });
});

import { endingFromLoudness } from "./loudness";
describe("ending from loudness", () => {
  const hop = 0.25;
  const steady = (sec: number, v = 0.5) => new Array(Math.round(sec / hop)).fill(v);
  it("hears a cold stop", () => {
    expect(endingFromLoudness([...steady(40), ...steady(3, 0)], hop).cue).toBe("cold stop");
  });
  it("hears a fade", () => {
    const fade = Array.from({ length: 40 }, (_, i) => 0.5 * Math.pow(0.85, i)); // 10 s fade
    expect(endingFromLoudness([...steady(40), ...fade, ...steady(2, 0)], hop).cue).toBe("repeat and fade");
  });
  it("says so when it can't tell", () => {
    expect(endingFromLoudness(steady(4), hop).cue).toBeNull();
  });
});
