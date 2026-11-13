import { describe, expect, it } from "vitest";
import { diffCharts } from "./diff";
import { checkChart } from "./validate";
import { EXAMPLE_CHARTS } from "./examples";

const BASE = `{title: Test}
{key: G}

[V] 1 4 5 1 | 1 4 5 5
[C] 1 5 6- 4
`;

describe("bar diff", () => {
  it("finds nothing when charts match", () => {
    const d = diffCharts(BASE, BASE);
    expect(d.changedBars).toBe(0);
    expect(d.rows.every((r) => r.state === "same")).toBe(true);
  });

  it("marks one changed bar with its old value", () => {
    const d = diffCharts(BASE, BASE.replace("[C] 1 5 6- 4", "[C] 1 5 6- 5"));
    expect(d.changedBars).toBe(1);
    const c = d.rows.find((r) => r.label === "C")!;
    expect(c.state).toBe("changed");
    expect(c.cells.map((x) => x.state)).toEqual(["same", "same", "same", "changed"]);
    expect(c.cells[3]).toMatchObject({ text: "5", old: "4" });
  });

  it("splits a section into rows and only flags the row that changed", () => {
    const d = diffCharts(BASE, BASE.replace("| 1 4 5 5", "| 1 4 2- 5"));
    expect(d.rows.find((r) => r.label === "V")!.state).toBe("same");
    const second = d.rows.find((r) => r.label === "V ·")!;
    expect(second.state).toBe("changed");
    expect(second.cells[2]).toMatchObject({ text: "2-", old: "5", state: "changed" });
  });

  it("shows added and removed sections", () => {
    const added = diffCharts(BASE, BASE + "[B] 4 5 6- 6-\n");
    expect(added.rows.at(-1)).toMatchObject({ label: "B", state: "added" });
    expect(added.changedBars).toBe(4);
    const removed = diffCharts(BASE, BASE.replace("[C] 1 5 6- 4\n", ""));
    expect(removed.rows.at(-1)).toMatchObject({ label: "C", state: "removed" });
  });

  it("shows an inserted bar as added, not every later bar as changed", () => {
    const d = diffCharts(BASE, BASE.replace("[C] 1 5 6- 4", "[C] 1 5 5 6- 4"));
    const c = d.rows.find((r) => r.label === "C")!;
    expect(c.cells.filter((x) => x.state !== "same")).toHaveLength(1);
    expect(c.cells.find((x) => x.state !== "same")!.state).toBe("added");
  });

  it("flags header changes such as a new key", () => {
    const d = diffCharts(BASE, BASE.replace("{key: G}", "{key: A}"));
    const h = d.rows.filter((r) => r.label === "Header" && r.state === "changed");
    expect(h).toHaveLength(1);
    expect(h[0].cells[0]).toMatchObject({ text: "{key: A}", old: "{key: G}" });
  });

  it("handles split bars, cues and dynamics as cells", () => {
    const ex = EXAMPLE_CHARTS[1].text;
    const d = diffCharts(ex, ex.replace("(4 5) 1 5! NC", "(4 5) 1 5~ NC"));
    expect(d.changedBars).toBe(1);
    const cell = d.rows.flatMap((r) => r.cells).find((c) => c.state === "changed")!;
    expect(cell).toMatchObject({ text: "5~", old: "5!" });
  });
});

describe("checkChart (save guard)", () => {
  it("accepts every example chart and keeps it canonical", () => {
    for (const { text } of EXAMPLE_CHARTS) {
      const c = checkChart(text);
      expect(c.ok).toBe(true);
      expect(c.canonical).toBe(text);
    }
  });

  it("adds the final newline and normalises line endings", () => {
    expect(checkChart("{title: X}\r\n{key: C}\r\n[V] 1 4").canonical).toBe("{title: X}\n{key: C}\n[V] 1 4\n");
  });

  it("blocks cues longer than six words (no lyrics)", () => {
    const c = checkChart(`{title: X}\n{key: C}\n[V] "and then we all went down to town" 1 4\n`);
    expect(c.ok).toBe(false);
    expect(c.longCues).toHaveLength(1);
    expect(checkChart(`{title: X}\n{key: C}\n[V] "drums only" 1 4\n`).ok).toBe(true);
  });

  it("reports parse errors and empty charts", () => {
    expect(checkChart("[V] (1").ok).toBe(false);
    expect(checkChart("[V] (1").error).toBeTruthy();
    expect(checkChart("   ").error).toMatch(/empty/);
  });
});
