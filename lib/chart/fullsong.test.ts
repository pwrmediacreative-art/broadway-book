import { describe, expect, it } from "vitest";
import { buildView, parseChart } from "./index";
import { pageFull, stageFull } from "../prefs";

// Full song (Q17): the paper layout reads real section names, in song order, repeats kept.
describe("Full song section names", () => {
  const text = [
    "{title: Son of a Preacher Man}",
    "{key: E}",
    "[Intro]",
    "1 1 1 1",
    "[V]",
    "1 (4 1) 1 5 | 5 5 5",
    "[C x2]",
    "1 (4 1) 1 (4 1)",
    "[V2]",
    "1 (4 1) 1 5",
    "[B]",
    "b7 b7 4 4",
    '["Big ending"]',
    "1",
  ].join("\n");
  const view = buildView(parseChart(text).doc);

  it("spells out the names players read on paper", () => {
    expect(view.sections.map((s) => s.name)).toEqual(["Intro", "Verse", "Chorus", "Verse 2", "Bridge", "Big ending"]);
  });

  it("keeps every section in song order with its repeat count", () => {
    expect(view.sections.map((s) => s.repeat)).toEqual([1, 1, 2, 1, 1, 1]);
    expect(view.sections[1].label).toBe("V");
  });
});

describe("Full song layout choice", () => {
  it("opens stage mode in Full song unless the player picked Scrolling", () => {
    expect(stageFull(null)).toBe(true);
    expect(stageFull("whole")).toBe(true);
    expect(stageFull("scroll")).toBe(false);
  });

  it("keeps the song page scrolling unless the player picked Full song", () => {
    expect(pageFull(null)).toBe(false);
    expect(pageFull("scroll")).toBe(false);
    expect(pageFull("whole")).toBe(true);
  });
});
