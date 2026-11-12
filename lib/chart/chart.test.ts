import { describe, expect, it } from "vitest";
import {
  ChartParseError,
  buildView,
  chordName,
  degreeToNote,
  getMeta,
  parseChart,
  parseKey,
  renumberDegree,
  serializeChart,
  type ChordItem,
} from "./index";
import { EXAMPLE_CHARTS } from "./examples";

const WAGON = `{title: Wagon Wheel}
{artist: Old Crow Medicine Show}
{key: A} {bpm: 140} {time: 4/4}
[Intro] 1 5 6- 4 | 1 5 4 4
[V] 1 5 6- 4 | 1 5 4 4
[C] 1 5 6- 4 | 1 5 4 4
`;

const EVERYTHING = `{title: Kitchen Sink}
{artist: Test}
{key: Bb} {bpm: 96} {time: 3/4}
{feel: two-step} {tags: test, a b}
{numbers: minor}

# comment line
[Intro] "drums only" NC ^NC <NC> %
[V] 1 b3 #4dim 7-7b5 | 1maj7 47 5sus 5sus4 2sus2 1add9 | 6-/5 1/3 b7/b3 5aug 1+ 57#9
[V2] ^1 <4> 5~ 5! ^<b6>~ (1 4) (1 1 4 5) (^<5> NC)
[Pre x2] << 1 4 >> 5
1 | 4 | 5
[C] {bpm: 120} 1 {feel: half time} 4 {time: 4/4} 5 {key: C} 1
[B] 1 {mod: +1} 4
{mod: -2}
[Solo]
[Turn] 1
[Tag x3] 4 5
[Outro] <1>~

#
`;

describe("parser", () => {
  it("reads the Wagon Wheel example", () => {
    const { doc, warnings } = parseChart(WAGON);
    expect(warnings).toEqual([]);
    const meta = getMeta(doc);
    expect(meta).toMatchObject({ title: "Wagon Wheel", key: "A", bpm: 140, time: "4/4" });
    const intro = doc.lines[3];
    expect(intro.kind).toBe("section");
    if (intro.kind !== "section") return;
    expect(intro.section).toEqual({ name: "Intro", number: null, repeat: null });
    expect(intro.rows).toHaveLength(2);
    expect(intro.rows[0][2]).toMatchObject({ kind: "chord", root: { acc: "", degree: 6 }, quality: "-" });
  });

  it("reads modifiers, split bars, dynamics, cues and repeats", () => {
    const { doc } = parseChart(EVERYTHING);
    const v2 = doc.lines.find((l) => l.kind === "section" && l.section.number === 2);
    if (v2?.kind !== "section") throw new Error("no V2");
    const [push, diamond, fermata, stop, all, split] = v2.rows[0];
    expect(push).toMatchObject({ push: true, diamond: false, end: "" });
    expect(diamond).toMatchObject({ diamond: true });
    expect(fermata).toMatchObject({ end: "fermata" });
    expect(stop).toMatchObject({ end: "stop" });
    expect(all).toMatchObject({ push: true, diamond: true, end: "fermata", root: { acc: "b", degree: 6 } });
    expect(split).toMatchObject({ kind: "split", beats: [{ root: { degree: 1 } }, { root: { degree: 4 } }] });
    const pre = doc.lines.find((l) => l.kind === "section" && l.section.repeat === 2);
    if (pre?.kind !== "section") throw new Error("no Pre");
    expect(pre.rows[0][0]).toEqual({ kind: "dynamic", value: "cresc" });
  });

  it("reads slash chords and qualities", () => {
    const { doc } = parseChart(EVERYTHING);
    const v = doc.lines.find((l) => l.kind === "section" && l.section.name === "V" && !l.section.number);
    if (v?.kind !== "section") throw new Error("no V");
    expect(v.rows[0][3]).toMatchObject({ root: { degree: 7 }, quality: "-7b5" });
    expect(v.rows[2][0]).toMatchObject({ quality: "-", bass: { acc: "", degree: 5 } });
    expect(v.rows[2][2]).toMatchObject({ root: { acc: "b", degree: 7 }, bass: { acc: "b", degree: 3 } });
  });

  it.each([
    ["1 4 5", "bars must come after a section label"],
    ["[Verse] 1", "unknown section"],
    ["[V] 1 8", `can't read "8"`],
    ["[V] 1 | | 4", "empty line"],
    ["[V] (1)", "2 or more chords"],
    ["[V] (1 (4 5))", "can't nest"],
    ["[V] <1", `can't read "<1"`],
    ['[V] "unclosed', "unclosed quote"],
    ["{key: H}", "is not a key"],
    ["{bpm: fast}", "must be a number"],
    ["{lyrics: no}", "unknown tag"],
    ["[V] 1 {mod: up}", "+1 or -2"],
    ["[V] 1 {title: x}", "unknown in-chart tag"],
  ])("rejects %j", (text, msg) => {
    expect(() => parseChart(text)).toThrow(ChartParseError);
    expect(() => parseChart(text)).toThrow(msg);
  });

  it("reports the line number", () => {
    expect(() => parseChart("{title: x}\n[V] 1\n[V] 9")).toThrow("Line 3:");
  });

  it("warns on long cues and missing title/key", () => {
    const { warnings } = parseChart('[V] "this cue is way too long for a chart"');
    expect(warnings.join("\n")).toMatch(/long/);
    expect(warnings).toContain("Missing {title:}");
    expect(warnings).toContain("Missing {key:}");
  });
});

describe("round trip", () => {
  const cases: [string, string][] = [
    ["wagon wheel", WAGON],
    ["everything", EVERYTHING],
    ...EXAMPLE_CHARTS.map((e) => [e.slug, e.text] as [string, string]),
  ];

  it.each(cases)("%s: text -> json -> text is identical", (_, text) => {
    expect(serializeChart(parseChart(text).doc)).toBe(text);
  });

  it.each(cases)("%s: json -> text -> json is identical", (_, text) => {
    const doc = parseChart(text).doc;
    expect(parseChart(serializeChart(doc)).doc).toEqual(doc);
  });

  it("normalises messy spacing to canonical text", () => {
    const messy = "  {key:A}   {bpm:  140 }\n[C  x2]   1   5|6-  4  \r\n";
    expect(serializeChart(parseChart(messy).doc)).toBe("{key: A} {bpm: 140}\n[C x2] 1 5 | 6- 4\n");
  });
});

describe("transpose", () => {
  const chord = (text: string) => {
    const { doc } = parseChart(`[V] ${text}`);
    const l = doc.lines[0];
    if (l.kind !== "section") throw new Error();
    return l.rows[0][0] as ChordItem;
  };
  const name = (text: string, key: string, style: "minor" | "relative" = "minor") =>
    chordName(chord(text), parseKey(key)!, style);

  it("A key: 1=A, 4=D, 5=E, 6-=F#m", () => {
    expect(["1", "4", "5", "6-"].map((c) => name(c, "A"))).toEqual(["A", "D", "E", "F#m"]);
  });

  it("spells flats and sharps by key", () => {
    expect(name("4", "F")).toBe("Bb");
    expect(name("b7", "E")).toBe("D");
    expect(name("5", "Db")).toBe("Ab");
    expect(name("3-", "B")).toBe("D#m");
    expect(name("7-7b5", "C")).toBe("Bm7b5");
    expect(name("b3", "Gb")).toBe("A"); // Bbb is shown as A
    expect(name("1/3", "A")).toBe("A/C#");
    expect(name("6-/5", "G")).toBe("Em/D");
    expect(name("1maj7", "Eb")).toBe("Ebmaj7");
    expect(name("#4dim", "C")).toBe("F#dim");
  });

  it("minor keys: 1 is the minor tonic by default", () => {
    expect(name("1-", "Am")).toBe("Am");
    expect(name("b3", "Am")).toBe("C");
    expect(name("b7", "Am")).toBe("G");
    expect(name("5", "Am")).toBe("E");
    expect(name("1-", "F#m")).toBe("F#m");
    expect(name("b6", "F#m")).toBe("D");
  });

  it("minor keys: relative style counts from the relative major", () => {
    expect(name("6-", "Am", "relative")).toBe("Am");
    expect(name("1", "Am", "relative")).toBe("C");
    expect(name("5", "Am", "relative")).toBe("G");
    expect(name("6-", "Ebm", "relative")).toBe("Ebm");
    expect(name("1", "Ebm", "relative")).toBe("Gb");
  });

  it("renumbers between minor and relative styles", () => {
    const d = (acc: "" | "b" | "#", degree: number) => ({ acc, degree });
    expect(renumberDegree(d("", 1), "minor", "relative")).toEqual(d("", 6));
    expect(renumberDegree(d("b", 3), "minor", "relative")).toEqual(d("", 1));
    expect(renumberDegree(d("b", 7), "minor", "relative")).toEqual(d("", 5));
    expect(renumberDegree(d("", 5), "minor", "relative")).toEqual(d("", 3));
    for (const [acc, deg] of [["", 1], ["b", 3], ["", 4], ["", 5], ["b", 6], ["b", 7]] as const) {
      const there = renumberDegree(d(acc, deg), "minor", "relative");
      expect(renumberDegree(there, "relative", "minor")).toEqual(d(acc, deg));
    }
  });

  it("degreeToNote handles every degree in C", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => degreeToNote({ acc: "", degree: n }, parseKey("C")!))).toEqual([
      "C", "D", "E", "F", "G", "A", "B",
    ]);
  });
});

describe("view", () => {
  const shuffle = EXAMPLE_CHARTS.find((e) => e.slug === "lower-broadway-shuffle")!.text;
  const blues = EXAMPLE_CHARTS.find((e) => e.slug === "printers-alley-blues")!.text;

  it("shows numbers and chord names in the chart's key", () => {
    const v = buildView(parseChart(WAGON).doc);
    expect(v.displayKey).toBe("A");
    expect(v.sections.map((s) => s.label)).toEqual(["Intro", "V", "C"]);
    expect(v.sections[0].rows[0]).toEqual([
      { kind: "bar", beats: [{ num: "1", chord: "A" }] },
      { kind: "bar", beats: [{ num: "5", chord: "E" }] },
      { kind: "bar", beats: [{ num: "6-", chord: "F#m" }] },
      { kind: "bar", beats: [{ num: "4", chord: "D" }] },
    ]);
  });

  it("transposes to another key and follows key changes", () => {
    const v = buildView(parseChart(shuffle).doc, { key: "G" });
    expect(v.displayKey).toBe("G");
    const intro = v.sections[0].rows[0];
    expect(intro[1]).toEqual({ kind: "bar", beats: [{ num: "^1", chord: "^G" }] });
    const change = v.sections.find((s) => s.label === "B")!.rows.at(-1)!;
    expect(change).toEqual([{ kind: "change", text: "Up half step → Ab" }]);
    const lastC = v.sections.filter((s) => s.label === "C")[0];
    expect(lastC.rows[0][0]).toEqual({ kind: "bar", beats: [{ num: "1", chord: "Ab" }] });
    const outro = v.sections.at(-1)!.rows[0];
    expect(outro.at(-1)).toEqual({ kind: "bar", beats: [{ num: "<1>~", chord: "<Ab>~" }] });
  });

  it("ignores a display key in the wrong mode", () => {
    expect(buildView(parseChart(WAGON).doc, { key: "Am" }).displayKey).toBe("A");
  });

  it("flips a minor chart between numbering styles, chord names unchanged", () => {
    const doc = parseChart(blues).doc;
    const minor = buildView(doc);
    const rel = buildView(doc, { style: "relative" });
    expect(minor.minor).toBe(true);
    expect(minor.sections[0].rows[0].map((c) => (c.kind === "bar" ? c.beats[0].num : ""))).toEqual(["1-", "b6", "b7", "1-"]);
    expect(rel.sections[0].rows[0].map((c) => (c.kind === "bar" ? c.beats[0].num : ""))).toEqual(["6-", "4", "5", "6-"]);
    const names = (v: typeof minor) => JSON.stringify(v.sections.map((s) => s.rows.map((r) => r.map((c) => (c.kind === "bar" ? c.beats.map((b) => b.chord) : c)))));
    expect(names(rel)).toBe(names(minor));
    expect(minor.sections[0].rows[0].map((c) => (c.kind === "bar" ? c.beats[0].chord : ""))).toEqual(["Am", "F", "G", "Am"]);
  });

  it("shows NC as N.C. in chord mode", () => {
    const v = buildView(parseChart("{key: C}\n[V] NC ^<NC>!").doc);
    expect(v.sections[0].rows[0]).toEqual([
      { kind: "bar", beats: [{ num: "NC", chord: "N.C." }] },
      { kind: "bar", beats: [{ num: "^<NC>!", chord: "^<N.C.>!" }] },
    ]);
  });
});
