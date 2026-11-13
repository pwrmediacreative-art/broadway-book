import { describe, expect, it } from "vitest";
import { buildView, parseChart } from "../chart";
import { lineRows, unclearMarks } from "./unclear";
import { cleanSkip, readPrefs } from "./queue";
import { reviewKey } from "./keys";

const CHART = [
  "{title: Mark Test}",
  "{key: G}",
  "[Intro] 1 4",
  "# UNCLEAR: V bar 2: 4 or 2-",
  "[V] 1 4 5 1",
  "1 4 5 5",
  "{mod: +1}",
  "# UNCLEAR: C bar 1: maybe 6-",
  "# UNCLEAR: C bar 3: smudged",
  "[C] 4 5 1 1",
  "{mod: -1}",
  "2- 5 1 1",
].join("\n");

const key = (k: string, mods: Partial<{ meta: boolean; ctrl: boolean; shift: boolean; alt: boolean }> = {}) =>
  reviewKey({ key: k, metaKey: !!mods.meta, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, altKey: !!mods.alt });

describe("lineRows", () => {
  it("maps chart lines to the preview rows buildView draws", () => {
    const { doc } = parseChart(CHART);
    const view = buildView(doc);
    const map = lineRows(doc);
    // every mapped key exists in the view, and every view row is mapped exactly once
    const keys = [...map.values()].flat();
    const all = view.sections.flatMap((s, i) => s.rows.map((_, j) => `${i}-${j}`));
    expect(keys.sort()).toEqual(all.sort());
    expect(map.get(2)).toEqual(["0-0"]); // [Intro]
    expect(map.get(4)).toEqual(["1-0"]); // [V]
    expect(map.get(5)).toEqual(["1-1"]); // second V line
    expect(map.get(6)).toEqual(["2-0"]); // {mod} before [C] joins the chorus
    expect(map.get(9)).toEqual(["2-1"]); // [C]
    expect(map.get(10)).toEqual(["2-2"]); // {mod} inside the chorus
    expect(map.get(11)).toEqual(["2-3"]);
  });
});

describe("unclearMarks", () => {
  it("points each note at the chart line under it, skipping stacked notes", () => {
    const { doc } = parseChart(CHART);
    const marks = unclearMarks(CHART, doc);
    expect(marks.map((m) => [m.note.line, m.target, m.rows])).toEqual([
      [3, 4, ["1-0"]],
      [7, 9, ["2-1"]],
      [8, 9, ["2-1"]],
    ]);
  });
  it("still finds notes when the chart doesn't parse", () => {
    const marks = unclearMarks("# UNCLEAR: V bar 1: x\n[V] 1 (", null);
    expect(marks).toHaveLength(1);
    expect(marks[0].target).toBe(1);
    expect(marks[0].rows).toEqual([]);
  });
  it("a note at the end has no target", () => {
    expect(unclearMarks("[V] 1\n# UNCLEAR: key: none written", null)[0].target).toBeNull();
  });
});

describe("readPrefs", () => {
  it("URL beats cookie beats defaults, junk ignored", () => {
    expect(readPrefs({}, null)).toEqual({ filter: "needs_review", order: "conf_desc" });
    expect(readPrefs({}, "duplicates.artist")).toEqual({ filter: "duplicates", order: "artist" });
    expect(readPrefs({ o: "title" }, "duplicates.artist")).toEqual({ filter: "duplicates", order: "title" });
    expect(readPrefs({ f: "nope", o: ["conf_asc"] }, "x.y")).toEqual({ filter: "needs_review", order: "conf_asc" });
    expect(readPrefs({ f: "toString" }, "constructor.__proto__")).toEqual({ filter: "needs_review", order: "conf_desc" });
  });
  it("cleanSkip keeps unique uuids only", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    expect(cleanSkip([id, id, "x", 3])).toEqual([id]);
    expect(cleanSkip("nope")).toEqual([]);
  });
});

describe("reviewKey", () => {
  it("maps the shortcuts on Mac and Windows", () => {
    expect(key("Enter", { meta: true })).toBe("publish");
    expect(key("Enter", { ctrl: true, shift: true })).toBe("unverified");
    expect(key("s", { meta: true })).toBe("save");
    expect(key("U", { meta: true, shift: true })).toBe("cant_read");
    expect(key("K", { ctrl: true, shift: true })).toBe("skip");
  });
  it("ignores plain typing and other combos", () => {
    expect(key("Enter")).toBeNull();
    expect(key("s")).toBeNull();
    expect(key("u", { meta: true })).toBeNull();
    expect(key("s", { meta: true, alt: true })).toBeNull();
    expect(key("S", { meta: true, shift: true })).toBeNull();
  });
});
