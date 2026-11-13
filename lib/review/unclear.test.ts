import { describe, expect, it } from "vitest";
import { unclearNotes } from "./unclear";

const CHART = [
  "{title: Pop A Top}",
  "# UNCLEAR: Intro bar 1-2: four quarter rests then a dotted 1",
  '[Intro] "guitar riff" NC 1',
  "# a normal comment",
  "#UNCLEAR not a note (no space)",
  "# UNCLEAR missing colon",
  "[C] 4 5 (5 4) 1",
].join("\n");

describe("unclearNotes", () => {
  it("finds every UNCLEAR note with where/what and its position", () => {
    const n = unclearNotes(CHART);
    expect(n).toHaveLength(2);
    expect(n[0]).toMatchObject({ line: 1, where: "Intro bar 1-2", saw: "four quarter rests then a dotted 1" });
    expect(CHART.slice(n[0].start, n[0].end)).toBe(CHART.split("\n")[1]);
    expect(n[1]).toMatchObject({ line: 5, where: "", saw: "missing colon" });
  });
  it("matches the database's count (lines starting '# UNCLEAR')", () => {
    const db = CHART.split("\n").filter((l) => l.startsWith("# UNCLEAR")).length;
    expect(unclearNotes(CHART)).toHaveLength(db);
  });
  it("is empty for a clean chart", () => {
    expect(unclearNotes("[V] 1 4 5 1\n")).toEqual([]);
  });
});
