import { describe, expect, it } from "vitest";
import { buildView, parseChart } from "../chart";
import { EXAMPLE_CHARTS } from "../chart/examples";
import { locateBar, refAt, refMatches, sectionBars, spotLabel } from "./ref";

const view = (t: string, key?: string) => buildView(parseChart(t).doc, { key });
const CHART = `{title: T}
{key: G}
[Intro] 1 "drums only" 4
[V] 1 (4 5) | << 6- 5
{key: A}
[C x2] ^4 1 {mod: +1} 5~ %
`;

describe("bar references", () => {
  it("finds every bar of every example chart in the chart text", () => {
    for (const { text } of EXAMPLE_CHARTS) {
      const v = view(text);
      v.sections.forEach((_, s) => {
        sectionBars(v, s).forEach((beats, b) => {
          const at = locateBar(text, s, b);
          const want = beats.length === 1 ? beats[0].src : `(${beats.map((x) => x.src).join(" ")})`;
          expect(at && text.slice(at.start, at.end)).toBe(want);
        });
        expect(locateBar(text, s, sectionBars(v, s).length)).toBeNull();
      });
    }
  });

  it("skips cues, tags and dynamics and counts split bars once", () => {
    const at = (s: number, b: number) => {
      const r = locateBar(CHART, s, b);
      return r && CHART.slice(r.start, r.end);
    };
    expect(at(0, 1)).toBe("4");
    expect(at(1, 1)).toBe("(4 5)");
    expect(at(1, 2)).toBe("6-");
    expect(at(2, 2)).toBe("5~");
    expect(at(2, 3)).toBe("%");
    expect(at(3, 0)).toBeNull();
  });

  it("keeps the same reference in any key and notices a changed chart", () => {
    const ref = refAt(view(CHART), 1, 1, 1)!;
    expect(ref).toEqual({ section: 1, label: "V", bar: 1, beat: 1, text: "5" });
    expect(refAt(view(CHART), 2, 0, 0)).toMatchObject({ label: "C", text: "^4" });
    expect(refMatches(view(CHART, "Bb"), ref)).toBe(true);
    expect(refMatches(view(CHART.replace("(4 5)", "(4 2-)")), ref)).toBe(false);
    expect(refMatches(view(CHART.replace("[V]", "[B]")), ref)).toBe(false);
    expect(refMatches(view(CHART.replace("[V] 1 (4 5)", "[V] (4 5)")), ref)).toBe(false);
    expect(refMatches(null, ref)).toBe(false);
    expect(refAt(view(CHART), 1, 9, 0)).toBeNull();
    expect(spotLabel(ref, true)).toBe("V · bar 2 · chord 2");
    expect(spotLabel({ ...ref, beat: 0 }, false)).toBe("V · bar 2");
  });
});
