import { describe, expect, it } from "vitest";
import { checkChart } from "../chart";
import { withName } from "./name";

const CHART = "{title: Old Name}\n{artist: Old Band}\n{key: G}\n\n[V] 1 4 5 1\n";

describe("withName (chart editor shows a renamed song's current name)", () => {
  it("replaces the title and artist lines", () => {
    expect(withName(CHART, "New Name", "New Band")).toBe("{title: New Name}\n{artist: New Band}\n{key: G}\n\n[V] 1 4 5 1\n");
  });
  it("is a no-op when the name already matches", () => {
    expect(withName(CHART, "Old Name", "Old Band")).toBe(CHART);
  });
  it("adds an artist line after the title when missing", () => {
    expect(withName("{title: A}\n{key: G}\n\n[V] 1\n", "A", "B")).toBe("{title: A}\n{artist: B}\n{key: G}\n\n[V] 1\n");
  });
  it("keeps $ and other special characters literally", () => {
    expect(withName(CHART, "$1 Beer", "AC/DC")).toContain("{title: $1 Beer}\n{artist: AC/DC}");
  });
  it("still round-trips through the parser", () => {
    const t = withName(CHART, "New Name", "New Band");
    expect(checkChart(t).canonical).toBe(t);
  });
});
