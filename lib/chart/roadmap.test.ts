import { describe, expect, it } from "vitest";
import { roadMap, roadText } from "./roadmap";

const v = (labels: [string, number][]) => ({ sections: labels.map(([label, repeat]) => ({ label, repeat })) }) as never;

describe("road map strip", () => {
  it("shortens names and keeps numbers and repeats", () => {
    const stops = roadMap(v([["Intro", 1], ["V", 1], ["C", 1], ["V2", 1], ["C x2", 2], ["Bridge", 1], ["Outro", 1]]));
    expect(roadText(stops)).toBe("I V C V2 C×2 B O");
  });
  it("keeps labels it doesn't know", () => {
    expect(roadText(roadMap(v([["Tag", 1], ["Solo", 2], ["Verse3", 1]])))).toBe("Tag Solo×2 V3");
  });
});
