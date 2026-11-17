import { describe, expect, it } from "vitest";
import { readStructure, songMap } from "./structure";

const G = (label: string) => `# UNCLEAR: ${label}: label from repeat pattern`;
const chart = (body: string) => `{title: Map Test}\n{key: G} {time: 4/4}\n${body}\n`;

describe("song map", () => {
  it("shows real names with bar counts for named parts", () => {
    const s = readStructure(chart("[Intro] 1 4\n[V] 1 4 5 1\n[C x2] 4 5 1 1\n[V2] 1 4 5 1"));
    expect(songMap(s).map((c) => [c.name, c.bars, c.repeat])).toEqual([
      ["Intro", 2, null],
      ["Verse", 4, null],
      ["Chorus", 4, 2],
      ["Verse 2", 4, null],
    ]);
  });

  it("keeps names the repeat pattern settled (Verse, Chorus)", () => {
    const s = readStructure(chart(`${G("V")}\n[V] 1 4 5 1\n${G("C")}\n[C] 4 5 1 1`));
    expect(songMap(s).map((c) => c.name)).toEqual(["Verse", "Chorus"]);
  });

  it("one one-off part between choruses is the Bridge", () => {
    const s = readStructure(chart(`${G("C")}\n[C] 4 5 1 1\n${G("B")}\n[B] 6- 4 1 5\n${G("C2")}\n[C2] 4 5 1 1`));
    expect(songMap(s).map((c) => c.name)).toEqual(["Chorus", "Bridge", "Chorus 2"]);
  });

  it("several one-off parts stay unnamed, never a raw letter", () => {
    const s = readStructure(chart(`${G("V")}\n[V] 1 4 5 1\n${G("B")}\n[B] 6- 4 1 5\n${G("C")}\n[C] 4 5 1 1\n${G("B2")}\n[B2] 2- 5 1 1`));
    expect(songMap(s).map((c) => c.name)).toEqual(["Verse", null, "Chorus", null]);
  });

  it("a Bridge someone named stays a Bridge", () => {
    const s = readStructure(chart("[V] 1 4 5 1\n[B] 6- 4 1 5\n[B2] 2- 5 1 1"));
    expect(songMap(s).map((c) => c.name)).toEqual(["Verse", "Bridge", "Bridge 2"]);
  });
});
