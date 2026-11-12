import { describe, expect, it } from "vitest";
import {
  buildView,
  keyName,
  keyPairLabel,
  keyPickerOptions,
  parseChart,
  parseKey,
  relativeKey,
  serializeChart,
  type ChartView,
  type ViewOptions,
} from "./index";
import { EXAMPLE_CHARTS } from "./examples";

const k = (s: string) => parseKey(s)!;
const cells = (v: ChartView) => v.sections.flatMap((s) => s.rows.flat());
const nums = (v: ChartView) => cells(v).flatMap((c) => (c.kind === "bar" ? c.beats.map((b) => b.num) : []));
const chords = (v: ChartView) => cells(v).flatMap((c) => (c.kind === "bar" ? c.beats.map((b) => b.chord) : []));
const changes = (v: ChartView) => cells(v).flatMap((c) => (c.kind === "change" ? [c.text] : []));
const view = (text: string, opts: ViewOptions = {}) => buildView(parseChart(text).doc, opts);

// Written from the minor tonic (parallel): home = 1-.
const FSM = `{key: F#m}
[V] 1- 4- b7 b3 | b6 5 1-/b3 ^<b7>~
`;
// Written from the relative major: home = 6-.
const GM_REL = `{key: Gm} {numbers: relative}
[V] 6- 2- 5 1 | 4 3 6-/1
`;

describe("relative keys", () => {
  it.each([
    ["Am", "C"],
    ["F#m", "A"],
    ["Gm", "Bb"],
    ["Ebm", "Gb"],
    ["C#m", "E"],
    ["Bbm", "Db"],
    ["G#m", "B"],
  ])("%s <-> %s", (minor, major) => {
    expect(keyName(relativeKey(k(minor)))).toBe(major);
    expect(keyName(relativeKey(k(major)))).toBe(minor);
  });

  it("labels the key pair with the numbering key first", () => {
    expect(keyPairLabel(k("Am"), "minor")).toBe("A minor (relative to C major)");
    expect(keyPairLabel(k("Am"), "relative")).toBe("C major (relative to A minor)");
    expect(keyPairLabel(k("F#m"), "minor")).toBe("F# minor (relative to A major)");
    expect(keyPairLabel(k("F#m"), "relative")).toBe("A major (relative to F# minor)");
    expect(keyPairLabel(k("Bbm"), "relative")).toBe("Db major (relative to Bb minor)");
    expect(keyPairLabel(k("Bb"), "minor")).toBe("Bb major");
    expect(keyPairLabel(k("Bb"), "relative")).toBe("Bb major");
  });
});

describe("relative / parallel flip", () => {
  it("F# minor: relabels every number, swaps the key, keeps the chord names", () => {
    const par = view(FSM, { style: "minor" });
    const rel = view(FSM, { style: "relative" });
    expect(nums(par)).toEqual(["1-", "4-", "b7", "b3", "b6", "5", "1-/b3", "^<b7>~"]);
    expect(nums(rel)).toEqual(["6-", "2-", "5", "1", "4", "3", "6-/1", "^<5>~"]);
    expect(chords(rel)).toEqual(chords(par));
    expect(chords(par)).toEqual(["F#m", "Bm", "E", "A", "D", "C#", "F#m/A", "^<E>~"]);
    expect([par.displayKey, par.numberKey, par.keyLabel, par.keyShort]).toEqual([
      "F#m",
      "F#m",
      "F# minor (relative to A major)",
      "F#m (A)",
    ]);
    expect([rel.displayKey, rel.numberKey, rel.keyLabel, rel.keyShort]).toEqual([
      "F#m",
      "A",
      "A major (relative to F# minor)",
      "A (F#m)",
    ]);
  });

  it("G minor written relative (Bb major numbers) flips to parallel", () => {
    const rel = view(GM_REL);
    const par = view(GM_REL, { style: "minor" });
    expect(rel.style).toBe("relative");
    expect(nums(par)).toEqual(["1-", "4-", "b7", "b3", "b6", "5", "1-/b3"]);
    expect(chords(par)).toEqual(chords(rel));
    expect(chords(rel)).toEqual(["Gm", "Cm", "F", "Bb", "Eb", "D", "Gm/Bb"]);
    expect(rel.keyLabel).toBe("Bb major (relative to G minor)");
    expect(par.keyLabel).toBe("G minor (relative to Bb major)");
  });

  it("flipping after transposing keeps chord names and the shown key in step", () => {
    const par = view(FSM, { key: "Ebm", style: "minor" });
    const rel = view(FSM, { key: "Ebm", style: "relative" });
    expect(chords(rel)).toEqual(chords(par));
    expect(chords(par)[0]).toBe("Ebm");
    expect(par.keyLabel).toBe("Eb minor (relative to Gb major)");
    expect(rel.keyLabel).toBe("Gb major (relative to Eb minor)");
  });

  it("major songs ignore the flip", () => {
    const text = "{key: Bb}\n[V] 1 4 5 6-\n";
    expect(nums(view(text, { style: "relative" }))).toEqual(["1", "4", "5", "6-"]);
    expect(view(text, { style: "relative" }).keyLabel).toBe("Bb major");
  });

  it("mid-song key changes follow the numbering view", () => {
    const text = "{key: Am}\n[V] 1-\n{key: Bm}\n[C] 1- {mod: +1} 1-\n";
    expect(changes(view(text, { style: "minor" }))).toEqual(["Key: Bm (D)", "Up half step → Cm (Eb)"]);
    expect(changes(view(text, { style: "relative" }))).toEqual(["Key: D (Bm)", "Up half step → Eb (Cm)"]);
  });
});

describe("minor symbol (display only)", () => {
  it("draws minor as 6m without touching chord names", () => {
    const dash = view(FSM, { style: "relative" });
    const m = view(FSM, { style: "relative", minorSymbol: "m" });
    expect(nums(m)).toEqual(["6m", "2m", "5", "1", "4", "3", "6m/1", "^<5>~"]);
    expect(chords(m)).toEqual(chords(dash));
    const first = m.sections[0].rows[0][0];
    expect(first.kind === "bar" && first.beats[0].n).toEqual({ root: "6", qual: "m", bass: "" });
  });

  it("keeps -7 style qualities readable: 2-7 -> 2m7", () => {
    expect(nums(view("{key: C}\n[V] 2-7 5 1\n", { minorSymbol: "m" }))).toEqual(["2m7", "5", "1"]);
  });

  it.each([FSM, GM_REL, ...EXAMPLE_CHARTS.map((e) => e.text)])("stored text still round-trips after every view", (text) => {
    const doc = parseChart(text).doc;
    const before = structuredClone(doc);
    for (const style of ["minor", "relative"] as const)
      for (const minorSymbol of ["-", "m"] as const) buildView(doc, { style, minorSymbol, key: "F#m" });
    expect(doc).toEqual(before);
    expect(serializeChart(doc)).toBe(text);
  });
});

describe("key picker", () => {
  it("parallel lists minor keys paired with their relative major", () => {
    const o = keyPickerOptions(k("Am"), "minor");
    expect(o).toHaveLength(12);
    expect(o.find((x) => x.value === "Am")?.label).toBe("Am (C)");
    expect(o.find((x) => x.value === "F#m")?.label).toBe("F#m (A)");
  });

  it("relative lists major keys first, values stay minor", () => {
    const o = keyPickerOptions(k("Am"), "relative");
    expect(o[0]).toMatchObject({ value: "Am", label: "C (Am)" });
    expect(o.map((x) => x.label)).toContain("Bb (Gm)");
    expect(o.find((x) => x.label === "D (Bm)")?.value).toBe("Bm");
  });

  it("keeps the song's own spelling for its key", () => {
    const o = keyPickerOptions(k("Ebm"), "relative");
    expect(o.find((x) => x.pc === 3)).toMatchObject({ value: "Ebm", label: "Gb (Ebm)" });
  });
});
