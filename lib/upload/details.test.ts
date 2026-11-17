import { describe, expect, it } from "vitest";
import { parseChart } from "../chart/parse";
import { serializeChart } from "../chart/serialize";
import { applyDetail, markAdded, openDetails } from "./details";
import { cueLabel, readStructure } from "./structure";

const chart = [
  "{title: Add Test}",
  "{key: G} {time: 4/4}",
  "# UNCLEAR: start: how the song starts isn't in the file",
  "# UNCLEAR: ending: cold stop, fade, ritard or tag?",
  "",
  "[V x2] 1 4 1 5",
  "# UNCLEAR: C bar 1: possible key change",
  "[C] 4 5 1 1",
  "[B] 6- 4 1 5",
  "",
].join("\n");
const roundTrips = (t: string) => expect(serializeChart(parseChart(t).doc)).toBe(t);

describe("+ Add… prompts", () => {
  it("lists what's missing", () => {
    expect(openDetails(readStructure(chart))).toEqual({ start: true, ending: true, solo: true, stop: true, key: [1] });
  });

  it("writes a quick-pick start and ending into the chart and reads them back", () => {
    let t = applyDetail(chart, { field: "start", pick: "drum intro", other: "" });
    t = applyDetail(t, { field: "ending", pick: "repeat and fade", other: "" });
    roundTrips(t);
    const s = readStructure(t);
    expect(s.start.cue).toBe("drum intro");
    expect(s.ending.cue).toBe("repeat and fade");
    expect(cueLabel(s.ending.cue!)).toBe("Repeat and fade");
    expect(t).not.toMatch(/UNCLEAR: (start|ending)/);
    expect(openDetails(s)).toMatchObject({ start: false, ending: false });
  });

  it("writes 'Other' words as start: / end: cues", () => {
    let t = applyDetail(chart, { field: "start", pick: null, other: "piano alone, 4 bars" });
    t = applyDetail(t, { field: "ending", pick: null, other: "big hold on 1" });
    roundTrips(t);
    expect(t).toContain('[V x2] "start: piano alone, 4 bars" 1 4 1 5');
    expect(t).toContain('[B] 6- 4 1 5 "end: big hold on 1"');
    const s = readStructure(t);
    expect(cueLabel(s.start.cue!)).toBe("Piano alone, 4 bars");
    expect(cueLabel(s.ending.cue!)).toBe("Big hold on 1");
    // changing the pick replaces the old one
    t = applyDetail(t, { field: "start", pick: "count off", other: "" });
    expect(readStructure(t).start.cue).toBe("count off");
    expect(t).not.toContain("piano alone");
  });

  it("never takes lyrics-length words", () => {
    expect(() => applyDetail(chart, { field: "start", pick: null, other: "one two three four five six" })).toThrow(/5 words/);
    expect(() => applyDetail(chart, { field: "ending", pick: null, other: "  " })).toThrow();
  });

  it("marks solo spots from the song form", () => {
    const t = applyDetail(chart, { field: "solo", parts: [0, 2], who: "fiddle" });
    roundTrips(t);
    const s = readStructure(t);
    expect(s.solos.map((x) => [x.part, x.who])).toEqual([
      [0, "fiddle solo"],
      [2, "fiddle solo"],
    ]);
    expect(openDetails(s).solo).toBe(false);
    expect(readStructure(applyDetail(chart, { field: "solo", parts: [1], who: "" })).solos).toEqual([{ part: 1, who: null, byPlayer: false }]);
  });

  it("adds stops and breaks as cues", () => {
    const t = applyDetail(chart, { field: "stop", parts: [1], pick: "band out", other: "" });
    roundTrips(t);
    const s = readStructure(t);
    expect(s.hasStops).toBe(true);
    expect(s.watch.map((w) => w.text)).toContain("“band out” in C");
  });

  it("answers a possible key change", () => {
    const up = applyDetail(chart, { field: "key", part: 1, pick: "+1", other: "" });
    roundTrips(up);
    expect(up).toContain("[C] {mod: +1} 4 5 1 1");
    expect(up).not.toContain("possible key change");
    const named = applyDetail(chart, { field: "key", part: 1, pick: null, other: "A" });
    expect(readStructure(named).watch.map((w) => w.text)).toContain("Key change to A in C");
    const none = applyDetail(chart, { field: "key", part: 1, pick: "none", other: "" });
    expect(openDetails(readStructure(none)).key).toEqual([]);
    expect(() => applyDetail(chart, { field: "key", part: 1, pick: null, other: "H" })).toThrow(/key like/);
  });

  it("refuses sections that aren't there", () => {
    expect(() => applyDetail(chart, { field: "solo", parts: [9], who: "" })).toThrow(/section/);
    expect(() => applyDetail(chart, { field: "stop", parts: [], pick: "stop", other: "" })).toThrow(/section/);
  });
});

describe("added by a player", () => {
  it("marks what a player filled in, and lists it for the count", () => {
    let after = applyDetail(chart, { field: "start", pick: "count off", other: "" });
    after = applyDetail(after, { field: "solo", parts: [2], who: "" });
    after = applyDetail(after, { field: "key", part: 1, pick: "none", other: "" });
    after = applyDetail(after, { field: "stop", parts: [0], pick: "stop", other: "" });
    const { text, fields } = markAdded(chart, after);
    roundTrips(text);
    expect(fields.sort()).toEqual(["key:1", "solo:2", "start", "stop:0"]);
    expect(text).toContain("# ADDED BY A PLAYER: start\n# ADDED BY A PLAYER: stop\n[V x2]");
    const s = readStructure(text);
    expect(s.start.byPlayer).toBe(true);
    expect(s.solos[0].byPlayer).toBe(true);
    expect(s.watch.find((w) => w.text === "“stop” in V")?.byPlayer).toBe(true);
    expect(s.ending.byPlayer).toBe(false);
  });

  it("saving again adds nothing new and doesn't repeat a mark", () => {
    const once = markAdded(chart, applyDetail(chart, { field: "ending", pick: "tag", other: "" })).text;
    expect(markAdded(once, once)).toEqual({ text: once, fields: [] });
    const changed = markAdded(once, applyDetail(once, { field: "ending", pick: "ritard", other: "" }));
    expect(changed.fields).toEqual(["ending"]);
    expect(changed.text.match(/ADDED BY A PLAYER: ending/g)).toHaveLength(1);
  });

  it("a chart straight from the file has no player marks", () => {
    const s = readStructure(chart);
    expect([s.start.byPlayer, s.ending.byPlayer, ...s.watch.map((w) => w.byPlayer)].some(Boolean)).toBe(false);
  });
});
