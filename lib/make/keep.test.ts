import { describe, expect, it } from "vitest";
import { checkChart, diffCharts } from "../chart";
import { keepLayout } from "./keep";
import { addPart, chord, duplicatePart, fromText, makeLabel, removePart, toText, type Made } from "./model";

// Full song Edit (Q17): a save keeps the chart's own layout, so a suggestion's bar diff shows
// only what the player changed. This chart is laid out nothing like the editor writes it:
// header values on their own lines, no time, a row of 8 bars, blank lines, rows joined by |.
const ORIGINAL = `{title: Test Song}
{artist: Someone}
{key: G}
{bpm: 120}

# UNCLEAR: Intro bar 2
[Intro] 1 1 4 4 5 5 1 1

[V]
1 4 5 1 | 1 4 5 5
6- 4 1 5

[C x2] 4 5 1 6- | 4 5 1 1
`;

const edit = (f: (m: Made) => Made) => keepLayout(ORIGINAL, toText(f(fromText(ORIGINAL))));
const changedLines = (a: string, b: string) => {
  const x = a.split("\n");
  const y = b.split("\n");
  return x.length === y.length ? x.flatMap((l, i) => (l === y[i] ? [] : [[l, y[i]]])) : null;
};
const valid = (text: string) => {
  const c = checkChart(text);
  expect(c.ok).toBe(true);
  expect(c.canonical).toBe(text); // round-trips exactly
};

describe("keepLayout", () => {
  it("writes an unchanged chart back exactly as it was", () => {
    expect(toText(fromText(ORIGINAL))).not.toBe(ORIGINAL); // the editor's own way differs
    expect(edit((m) => m)).toBe(ORIGINAL);
  });

  it("changes only the bar the player changed", () => {
    const out = edit((m) => ({
      ...m,
      parts: m.parts.map((p, i) => (i === 1 ? { ...p, items: p.items.map((x, j) => (j === 6 ? chord("b", 7) : x)) } : p)),
    }));
    valid(out);
    expect(changedLines(ORIGINAL, out)).toEqual([["1 4 5 1 | 1 4 5 5", "1 4 5 1 | 1 4 b7 5"]]);
    const d = diffCharts(ORIGINAL, out);
    expect([d.changedRows, d.changedBars]).toEqual([1, 1]);
  });

  it("keeps the row a new bar is added to", () => {
    const out = edit((m) => ({ ...m, parts: m.parts.map((p, i) => (i === 0 ? { ...p, items: [...p.items, chord("", 4)] } : p)) }));
    valid(out);
    expect(changedLines(ORIGINAL, out)).toEqual([["[Intro] 1 1 4 4 5 5 1 1", "[Intro] 1 1 4 4 5 5 1 1 4"]]);
  });

  it("adds a section without touching the others", () => {
    const out = edit((m) => addPart(m, makeLabel(m.parts, "Tag", false)).made);
    valid(out);
    expect(out.startsWith(ORIGINAL)).toBe(true);
    expect(out.slice(ORIGINAL.length)).toBe("[Tag]\n");
  });

  it("duplicates a section next to the original, the rest untouched", () => {
    const out = edit((m) => duplicatePart(m, m.parts[1].id).made);
    valid(out);
    const [before, after] = ORIGINAL.split("[C x2]");
    expect(out.startsWith(before)).toBe(true);
    expect(out.endsWith("[C x2]" + after)).toBe(true);
    expect(out.slice(before.length, out.length - after.length - "[C x2]".length)).toBe("[V2] 1 4 5 1 | 1 4 5 5 | 6- 4 1 5\n");
    expect(diffCharts(ORIGINAL, out).rows.filter((r) => r.state !== "same").every((r) => r.state === "added")).toBe(true);
  });

  it("deletes a section and only that section", () => {
    const out = edit((m) => removePart(m, m.parts[1].id));
    valid(out);
    expect(out).toBe(ORIGINAL.replace("[V]\n1 4 5 1 | 1 4 5 5\n6- 4 1 5\n\n", ""));
  });

  it("deleting the first section keeps the comment that sits above it with it", () => {
    const out = edit((m) => removePart(m, m.parts[0].id));
    valid(out);
    expect(out).not.toContain("UNCLEAR");
    expect(out).toContain("[V]\n1 4 5 1 | 1 4 5 5\n6- 4 1 5\n");
  });

  it("changes a header value in place", () => {
    const out = edit((m) => ({ ...m, header: { ...m.header, key: "A", bpm: 96 } }));
    valid(out);
    expect(changedLines(ORIGINAL, out)).toEqual([
      ["{key: G}", "{key: A}"],
      ["{bpm: 120}", "{bpm: 96}"],
    ]);
  });

  it("falls back to the editor's text when it can't keep the layout safely", () => {
    const edited = toText(fromText(ORIGINAL));
    expect(keepLayout("not a chart [", edited)).toBe(edited);
  });
});
