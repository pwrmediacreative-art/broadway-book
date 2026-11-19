// Q18 lyric placement. Fixtures use made-up placeholder lines only, never real lyrics.
import { describe, expect, it } from "vitest";
import { buildView, parseChart } from "../chart";
import { lrcLines, lyricLines, plainLines } from "./match";
import { autoPlace, barRows, decodePlacements, encodePlacements, labelHash, placeLines, stepRow } from "./place";

const chart = (head: string, body: string) => buildView(parseChart(`{title: Test}\n${head}\n\n${body}\n`).doc);
// 120 bpm 4/4: one bar = 2 seconds.
const BODY = "[Intro] 1 4 5 1\n[V] 1 1 4 4\n5 5 1 1\n[C x2] 4 5 1 1";
const timed = chart("{key: G} {bpm: 120} {time: 4/4}", BODY);
const untimed = chart("{key: G}", BODY);

describe("lyric lines", () => {
  it("reads synced lyrics in time order, a doubled stamp twice, breaks dropped", () => {
    const lines = lrcLines("[ti: x]\n[00:10.00] line one\n[00:04.50]\n[00:20.00][00:40.00] line two\n[00:12.5] line three");
    expect(lines).toEqual([
      { t: 10, text: "line one" },
      { t: 12.5, text: "line three" },
      { t: 20, text: "line two" },
      { t: 40, text: "line two" },
    ]);
  });
  it("plain lyrics: one line each, no blank lines", () => {
    expect(plainLines("line one\n\nline two\n")).toEqual([
      { t: null, text: "line one" },
      { t: null, text: "line two" },
    ]);
  });
  it("prefers the synced record", () => {
    const r = { id: 1, trackName: "x", artistName: "y", plainLyrics: "line one", syncedLyrics: "[00:01.00] line one" };
    expect(lyricLines(r)).toEqual({ lines: [{ t: 1, text: "line one" }], synced: true });
    expect(lyricLines({ ...r, syncedLyrics: null }).synced).toBe(false);
  });
});

describe("bar rows", () => {
  it("names rows by section label, nth and row", () => {
    const rows = barRows(timed);
    expect(rows.map((r) => r.key)).toEqual(["0.0", "1.0", "1.1", "2.0"]);
    expect(rows[3].ref).toEqual({ h: labelHash("C"), n: 0, r: 0 });
  });
  it("a row's name survives a section added before it", () => {
    const more = chart("{key: G} {bpm: 120}", `[Turn] 1 1 1 1\n${BODY}`);
    const before = barRows(timed)[2].ref; // V, second row
    const after = barRows(more).find((r) => r.ref.h === before.h && r.ref.n === before.n && r.ref.r === before.r);
    expect(after?.key).toBe("2.1");
  });
});

describe("auto-placement", () => {
  it("uses timestamps + BPM + time signature", () => {
    // Bars: Intro 0-3 (0-8s), V row 0 4-7 (8-16s), V row 1 8-11 (16-24s), C pass 1 12-15, pass 2 16-19.
    const lines = [{ t: 9, text: "line one" }, { t: 17, text: "line two" }, { t: 25, text: "line three" }, { t: 33, text: "line four" }];
    expect(autoPlace(timed, lines)).toEqual([1, 2, 3, 3]);
  });
  it("3/4 makes bars shorter", () => {
    const waltz = chart("{key: G} {bpm: 120} {time: 3/4}", BODY); // a bar = 1.5s
    expect(autoPlace(waltz, [{ t: 6.1, text: "line one" }])).toEqual([1]);
  });
  it("squeezes lyrics that run past the chart", () => {
    const at = autoPlace(timed, [{ t: 0, text: "a" }, { t: 400, text: "b" }]);
    expect(at).toEqual([0, 3]);
  });
  it("spreads plain lyrics (or no BPM) evenly over the rows in play order", () => {
    const lines = plainLines("one\ntwo\nthree\nfour\nfive");
    // Play order: Intro, V0, V1, C (pass 1), C (pass 2) = 5 rows.
    expect(autoPlace(timed, lines)).toEqual([0, 1, 2, 3, 3]);
    const synced = [{ t: 1, text: "a" }, { t: 30, text: "b" }];
    expect(autoPlace(untimed, synced)).toEqual([0, 2]);
  });
});

describe("placing and moving", () => {
  const lines = plainLines("one\ntwo\nthree\nfour\nfive");
  it("stacks every pass's lines under a repeated section's rows, in order", () => {
    const placed = placeLines(timed, lines, new Map());
    expect(placed.get("2.0")?.map((p) => p.text)).toEqual(["four", "five"]);
  });
  it("keeps a moved line where the player put it, and re-places it when its row is gone", () => {
    const rows = barRows(timed);
    const moved = new Map([[0, rows[2].ref]]);
    expect(placeLines(timed, lines, moved).get("1.1")?.map((p) => [p.text, p.moved])).toEqual([
      ["one", true],
      ["three", false],
    ]);
    // The verse loses its second row: "one" goes back to its automatic row.
    const edited = chart("{key: G} {bpm: 120}", "[Intro] 1 4 5 1\n[V] 1 1 4 4\n[C x2] 4 5 1 1");
    expect(placeLines(edited, lines, moved).get("0.0")?.[0]).toEqual({ line: 0, text: "one", moved: false });
  });
  it("steps one row up or down", () => {
    const rows = barRows(timed);
    expect(stepRow(rows, "1.0", 1)?.key).toBe("1.1");
    expect(stepRow(rows, "0.0", -1)).toBeNull();
  });
  it("saves only integers: line, label hash, nth, row", () => {
    const moved = new Map([[3, { h: labelHash("V"), n: 0, r: 1 }]]);
    const flat = encodePlacements(moved);
    expect(flat.every(Number.isInteger)).toBe(true);
    expect(flat).toHaveLength(4);
    expect(decodePlacements(flat)).toEqual(moved);
    expect(encodePlacements(new Map([[900, { h: 1, n: 0, r: 0 }]]))).toEqual([]);
  });
  it("saves lines in order and at most 64 section labels (what the database accepts)", () => {
    const many = new Map(Array.from({ length: 70 }, (_, i) => [69 - i, { h: 1000 + (69 - i), n: 0, r: 0 }] as const));
    const flat = encodePlacements(many);
    expect(flat).toHaveLength(64 * 4);
    const lines = flat.filter((_, i) => i % 4 === 0);
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
  });
});
