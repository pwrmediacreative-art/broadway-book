// Format additions for player-made charts (Q16): custom section names, repeat signs,
// boxed notes and charts with no key. Every new syntax round-trips exactly.
import { describe, expect, it } from "vitest";
import { buildView, checkChart, diffCharts, layoutRow, parseChart, serializeChart } from "./index";

const rt = (t: string) => expect(serializeChart(parseChart(t).doc)).toBe(t);

const PREACHER = `{title: Son of a Preacher Man}
{artist: Dusty Springfield}
{key: E} {bpm: 91} {time: 4/4}
[Intro] 1 1 1 1
[V] 1 (4 1) 5 | 5 5 5
[C] 1 (4 1) 1 (4 1) | (1 5) 4
[B] b7 b7 4 4 | 5 5 1 1 {mod: +5} "[Mod ↑ P.4th (1 becomes 5)]"
[C2] 1 (4 1) 1 (4 1) | (1 5) 4
[Outro] |: 1 (4 1) 1 (4 1) :|"repeat out"
`;

describe("custom section names", () => {
  it("round-trip", () => {
    rt(`{title: X}\n["Big ending"] 1 4 5 1\n`);
    rt(`{title: X}\n["Breakdown"2 x2] 1 4\n`);
    rt(`{title: X}\n["Drum break"]\n`);
  });

  it("parse as custom, built-in names stay built-in", () => {
    const { doc } = parseChart(`{title: X}\n["Breakdown"2 x3] 1\n[V2] 1\n`);
    const secs = doc.lines.filter((l) => l.kind === "section");
    expect(secs.map((l) => l.kind === "section" && l.section)).toEqual([
      { name: "Breakdown", custom: true, number: 2, repeat: 3 },
      { name: "V", custom: false, number: 2, repeat: null },
    ]);
  });

  it("still reject typos in unquoted names", () => {
    expect(() => parseChart(`{title: X}\n[Chrous] 1\n`)).toThrow(/unknown section \[Chrous\]/);
  });

  it("reject names that are too long or use reserved characters", () => {
    expect(() => parseChart(`{title: X}\n["one two three four five six seven"] 1\n`)).toThrow(/bad section name/);
    expect(() => parseChart(`{title: X}\n["a|b"] 1\n`)).toThrow(/bad section name/);
    expect(() => parseChart(`{title: X}\n[""] 1\n`)).toThrow(/bad section name/);
  });

  it("show with a space before the number", () => {
    const v = buildView(parseChart(`{title: X}\n["Breakdown"2 x2] 1\n[V2] 1\n`).doc);
    expect(v.sections.map((s) => s.label)).toEqual(["Breakdown 2 x2", "V2"]);
  });
});

describe("repeat signs", () => {
  it("round-trip, with and without a note", () => {
    rt(`{title: X}\n[V] |: 1 4 1 5 :|\n`);
    rt(`{title: X}\n[V] |: 1 4 | 1 5 :|"repeat out"\n`);
    rt(`{title: X}\n[V] 1 4 :| | |: 5 5\n`);
  });

  it("never split a line at the | of a repeat sign", () => {
    const { doc } = parseChart(`{title: X}\n[V] |: 1 4 | 1 5 :|"repeat out"\n`);
    const l = doc.lines[1];
    expect(l.kind === "section" && l.rows.length).toBe(2);
    expect(l.kind === "section" && l.rows[1].at(-1)).toEqual({ kind: "repeatSign", side: "end", text: "repeat out" });
  });

  it("sit on the bar edges when laid out", () => {
    const v = buildView(parseChart(`{title: X}\n[V] |: 1 4 1 5 :|"repeat out"\n`).doc);
    const [line] = layoutRow(v.sections[0].rows[0]);
    expect(line.bars.map((b) => [b.open, b.close])).toEqual([
      [true, null],
      [false, null],
      [false, null],
      [false, "repeat out"],
    ]);
  });

  it("reject a broken end sign", () => {
    expect(() => parseChart(`{title: X}\n[V] 1 :|x\n`)).toThrow(/bad repeat sign/);
  });
});

describe("boxed notes", () => {
  it("round-trip and stay apart from cues", () => {
    rt(`{title: X}\n[B] 5 5 1 1 "[Mod ↑ P.4th (1 becomes 5)]"\n`);
    rt(`{title: X}\n[V] "[Band in]" 1 "drums only" 4\n`);
    const { doc } = parseChart(`{title: X}\n[V] "[Band in]" "drums only" 1\n`);
    const l = doc.lines[1];
    expect(l.kind === "section" && l.rows[0].slice(0, 2)).toEqual([
      { kind: "box", text: "Band in" },
      { kind: "cue", text: "drums only" },
    ]);
  });

  it("are held to the 6-word limit like cues", () => {
    const c = checkChart(`{title: X}\n[V] "[one two three four five six seven]" 1\n`);
    expect(c.ok).toBe(false);
    expect(c.longCues).toEqual(["one two three four five six seven"]);
    expect(checkChart(`{title: X}\n[V] 1 :|"one two three four five six seven"\n`).ok).toBe(false);
  });

  it("carry the new key when they follow a key change", () => {
    const v = buildView(parseChart(PREACHER).doc);
    const box = v.sections[3].rows[1].find((c) => c.kind === "box");
    expect(box).toEqual({ kind: "box", text: "Mod ↑ P.4th (1 becomes 5)", key: "A" });
    // numbers after the change stay as written; chord names move to the new key
    const c2 = v.sections[4].rows[0][0];
    expect(c2.kind === "bar" && [c2.beats[0].num, c2.beats[0].chord]).toEqual(["1", "A"]);
  });
});

describe("charts with no key", () => {
  const NOKEY = `{title: Mine}\n{time: 4/4}\n[V] 1 4 5 1\n`;
  it("round-trip and parse with only a warning", () => {
    rt(NOKEY);
    expect(parseChart(NOKEY).warnings).toContain("Missing {key:}");
    expect(checkChart(NOKEY).ok).toBe(true);
  });

  it("show numbers, and chord names once the player picks a key", () => {
    const plain = buildView(parseChart(NOKEY).doc);
    expect([plain.displayKey, plain.keyShort]).toEqual([null, null]);
    const bar = plain.sections[0].rows[0][1];
    expect(bar.kind === "bar" && bar.beats[0].chord).toBe("4");
    const inG = buildView(parseChart(NOKEY).doc, { key: "G" });
    expect(inG.displayKey).toBe("G");
    const g = inG.sections[0].rows[0][1];
    expect(g.kind === "bar" && g.beats[0].chord).toBe("C");
  });
});

describe("the reference chart", () => {
  it("round-trips and diffs cleanly", () => {
    rt(PREACHER);
    expect(diffCharts(PREACHER, PREACHER).changedBars).toBe(0);
  });
});
