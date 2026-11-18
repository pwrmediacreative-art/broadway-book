import { describe, expect, it } from "vitest";
import { buildView, checkChart, parseChart, serializeChart } from "../chart";
import {
  addBeat,
  addPart,
  changedBars,
  chord,
  chunkRows,
  customNameError,
  dropBeat,
  duplicatePart,
  fromText,
  headerError,
  insertItems,
  keyChangeItems,
  makeLabel,
  movePart,
  newChartText,
  nextNumber,
  noteError,
  oldOneBecomes,
  partName,
  removePart,
  setItems,
  setRepeat,
  toText,
  toggleQuality,
  withLastBeat,
  type Made,
} from "./model";

const header = { title: "Son of a Preacher Man", artist: "Dusty Springfield", key: "E", time: "4/4", bpm: 91 };

/** Build the reference chart (docs/autopilot/ref) the way a player taps it in. */
function buildPreacher(): Made {
  let m = fromText(newChartText(header));
  const add = (name: string) => {
    const r = addPart(m, makeLabel(m.parts, name, false));
    m = r.made;
    return r.id;
  };
  const put = (id: string, items: Made["parts"][number]["items"]) => {
    m = setItems(m, id, items);
  };
  const split = (a: number, b: number) => addBeat(chord("", a), chord("", b));
  const intro = add("Intro");
  put(intro, [chord("", 1), chord("", 1), chord("", 1), chord("", 1)]);
  const verse = add("V");
  put(verse, [chord("", 1), split(4, 1), chord("", 5), chord("", 5), chord("", 5), chord("", 5)]);
  const chorus = add("C");
  put(chorus, [chord("", 1), split(4, 1), chord("", 1), split(4, 1), split(1, 5), chord("", 4)]);
  const bridge = add("B");
  put(bridge, [chord("b", 7), chord("b", 7), chord("", 4), chord("", 4), chord("", 5), chord("", 5), chord("", 1), chord("", 1), ...keyChangeItems(5)]);
  const dup = duplicatePart(m, chorus);
  m = dup.made;
  // move the copy to after the bridge
  m = movePart(movePart(m, dup.id, 1), dup.id, 1);
  const outro = add("Outro");
  put(outro, [
    { kind: "repeatSign", side: "start", text: "" },
    chord("", 1),
    split(4, 1),
    chord("", 1),
    split(4, 1),
    { kind: "repeatSign", side: "end", text: "repeat out" },
  ]);
  return m;
}

describe("made charts: building", () => {
  it("builds the reference chart into canonical text that round-trips", () => {
    const text = toText(buildPreacher());
    expect(text).toBe(`{title: Son of a Preacher Man}
{artist: Dusty Springfield}
{key: E} {bpm: 91} {time: 4/4}
[Intro] 1 1 1 1
[V] 1 (4 1) 5 5 | 5 5
[C] 1 (4 1) 1 (4 1) | (1 5) 4
[B] b7 b7 4 4 | 5 5 1 1 {mod: +5} "[Mod ↑ P.4th (1 becomes 5)]"
[C2] 1 (4 1) 1 (4 1) | (1 5) 4
[Outro] |: 1 (4 1) 1 (4 1) :|"repeat out"
`);
    expect(serializeChart(parseChart(text).doc)).toBe(text);
    expect(checkChart(text).ok).toBe(true);
    expect(toText(fromText(text))).toBe(text);
  });

  it("works in Chords view: the key change moves the chord names", () => {
    const v = buildView(parseChart(toText(buildPreacher())).doc);
    const after = v.sections[4].rows[0][0];
    expect(after.kind === "bar" && after.beats[0].chord).toBe("A");
  });

  it("saves a chart with no key", () => {
    const text = newChartText({ ...header, key: null, bpm: null });
    expect(text).toBe("{title: Son of a Preacher Man}\n{artist: Dusty Springfield}\n{time: 4/4}\n");
    expect(checkChart(text).ok).toBe(true);
  });

  it("checks the header", () => {
    expect(headerError({ title: " ", artist: "", key: null, time: "4/4" })).toMatch(/title/);
    expect(headerError({ title: "X", artist: "", key: "H", time: "4/4" })).toMatch(/key/);
    expect(headerError({ title: "X", artist: "", key: null, time: "12/8" })).toBeNull();
  });
});

describe("made charts: sections", () => {
  it("numbers repeats of a section and duplicates", () => {
    let m = fromText(newChartText(header));
    m = addPart(m, makeLabel(m.parts, "C", false)).made;
    expect(nextNumber(m.parts, "C", false)).toBe(2);
    const d = duplicatePart(m, m.parts[0].id);
    expect(d.made.parts.map((p) => partName(p.label))).toEqual(["Chorus", "Chorus 2"]);
    expect(nextNumber(d.made.parts, "C", false)).toBe(3);
    expect(partName(makeLabel([], "Big ending", true))).toBe("Big ending");
  });

  it("duplicates everything as an independent copy and spots the bars that differ", () => {
    let m = fromText(newChartText(header));
    const a = addPart(m, makeLabel(m.parts, "C", false));
    m = setItems(a.made, a.id, [
      { kind: "box", text: "Band in" },
      { kind: "repeatSign", side: "start", text: "" },
      chord("", 1),
      addBeat(chord("", 4), chord("", 5)),
      { kind: "repeatSign", side: "end", text: "" },
    ]);
    const d = duplicatePart(m, a.id);
    m = d.made;
    expect(m.parts[1].items).toEqual(m.parts[0].items);
    const items = [...m.parts[1].items];
    items[2] = chord("", 6);
    m = setItems(m, d.id, items);
    expect((m.parts[0].items[2] as { root: { degree: number } }).root.degree).toBe(1); // original untouched
    expect([...changedBars(m, d.id)]).toEqual([0]);
  });

  it("moves, repeats and deletes sections", () => {
    let m = fromText(newChartText(header));
    m = addPart(m, makeLabel(m.parts, "V", false)).made;
    m = addPart(m, makeLabel(m.parts, "C", false)).made;
    m = movePart(m, m.parts[1].id, -1);
    expect(m.parts.map((p) => p.label.name)).toEqual(["C", "V"]);
    m = setRepeat(m, m.parts[0].id, 2);
    expect(toText(m)).toContain("[C x2]");
    m = removePart(m, m.parts[0].id);
    expect(m.parts.map((p) => p.label.name)).toEqual(["V"]);
  });

  it("checks custom names and notes", () => {
    expect(customNameError("Big ending")).toBeNull();
    expect(customNameError("a [b]")).not.toBeNull();
    expect(customNameError("one two three four five six seven")).not.toBeNull();
    expect(noteError("Mod ↑ P.4th (1 becomes 5)")).toBeNull();
    expect(noteError("one two three four five six seven")).not.toBeNull();
  });
});

describe("made charts: number pad", () => {
  it("toggles qualities in the format's order", () => {
    expect(toggleQuality("", "minor")).toBe("-");
    expect(toggleQuality("-", "7")).toBe("-7");
    expect(toggleQuality("7", "maj7")).toBe("maj7");
    expect(toggleQuality("maj7", "7")).toBe("7");
    expect(toggleQuality("7", "sus")).toBe("7sus");
    expect(toggleQuality("-7", "minor")).toBe("7");
  });

  it("splits bars and puts modifiers on the last chord", () => {
    const s = addBeat(chord("", 1), chord("", 4));
    expect(s.kind).toBe("split");
    const pushed = withLastBeat(s, (b) => ({ ...b, push: true }) as typeof b);
    const text = toText({
      header: { ...header, extra: [] },
      parts: [{ id: "x", label: makeLabel([], "V", false), items: [pushed], comments: [], from: null }],
    });
    expect(text).toContain("[V] (1 ^4)");
    expect(dropBeat(s)).toEqual(chord("", 1));
  });

  it("writes key changes with the 'becomes' degree", () => {
    expect([1, 2, 5, 7, -2].map(oldOneBecomes)).toEqual(["7", "b7", "5", "4", "2"]);
    expect(keyChangeItems(2)).toEqual([
      { kind: "tag", name: "mod", value: "+2" },
      { kind: "box", text: "Mod ↑ whole (1 becomes b7)" },
    ]);
  });

  it("flows bars in rows of 4, notes staying with the next bar", () => {
    const items = insertItems([chord("", 1), chord("", 2), chord("", 3), chord("", 4), chord("", 5)], 4, [{ kind: "box", text: "Up" }]);
    expect(chunkRows(items).map((r) => r.length)).toEqual([4, 2]);
  });
});
