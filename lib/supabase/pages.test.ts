import { describe, expect, it } from "vitest";
import { allPages, PAGE_ROWS } from "./server";

describe("allPages", () => {
  it("reads past the 1,000-row API cap", async () => {
    const rows = Array.from({ length: 2368 }, (_, i) => i);
    const calls: [number, number][] = [];
    const out = await allPages<number>(async (from, to) => {
      calls.push([from, to]);
      return { data: rows.slice(from, to + 1), error: null };
    });
    expect(out).toHaveLength(2368);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(PAGE_ROWS).toBe(1000);
  });
  it("stops after one short page and throws on errors", async () => {
    expect(await allPages<number>(async () => ({ data: [1, 2], error: null }))).toEqual([1, 2]);
    await expect(allPages(async () => ({ data: null, error: new Error("boom") }))).rejects.toThrow("boom");
  });
});
