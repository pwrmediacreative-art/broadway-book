import { describe, expect, it } from "vitest";
import { createEngine } from "./engine";
import { packIndex, unpackIndex, type IndexRow } from "./pack";

const row = (slug: string, version_of: string | null = null): IndexRow => ({
  slug,
  title: "Wagon Wheel",
  artist: "Old Crow Medicine Show",
  key: "A",
  bpm: null,
  time_sig: null,
  feel: null,
  tags: [],
  is_example: false,
  version_of,
});

describe("player versions in search", () => {
  it("packs the version flag and lists the original first", () => {
    // the version sorts first by slug on purpose: search must still put the original first
    const docs = unpackIndex(packIndex([row("a-version", "orig-id"), row("wagon-wheel")]))!;
    expect(docs.map((d) => !!d.vb)).toEqual([true, false]);
    expect(createEngine(docs).search("wagon wheel")).toEqual(["wagon-wheel", "a-version"]);
  });
});
