import { describe, expect, it } from "vitest";
import { EXAMPLE_CHARTS } from "../chart/examples";
import { itemView, keyOptions, noteCheck, playLabel, playOrder, shownKey, startPos, step, type SetItem } from "./play";
import { decodeSnapshot, encodeSnapshot } from "./snapshot";

const CHART = "{title: Test}\n{key: G}\n\n[V] 1 4 5 1\n";
const song = (slug: string, title: string, chart_text = CHART) => ({ slug, title, artist: null, key: "G", chart_text });
const item = (slug: string, title: string, extra: Partial<SetItem> = {}): SetItem => ({ slug, key: null, note: null, song: song(slug, title), ...extra });
const gone = (): SetItem => ({ slug: null, key: null, note: null, song: null });

/** Walk play mode from one end until next/prev stops; return the titles seen. */
function walk(items: SetItem[], dir: 1 | -1 = 1) {
  const order = playOrder(items);
  let pos = dir > 0 ? 0 : order.length - 1;
  const seen = [items[order[pos]].song!.title];
  for (let p = step(order, pos, dir); p !== null; p = step(order, pos, dir)) {
    pos = p;
    seen.push(items[order[pos]].song!.title);
  }
  return { seen, pos, order };
}

describe("play mode order", () => {
  const titles = Array.from({ length: 18 }, (_, i) => `Song ${i + 1}`);
  const items = titles.map((t, i) => item(`s${i + 1}`, t));

  it("advances through the whole list and stops at the end", () => {
    const { seen, pos, order } = walk(items);
    expect(seen).toEqual(titles);
    expect(step(order, pos, 1)).toBeNull(); // no wrap past the last song
    expect(playLabel(items, order, pos)).toEqual({ count: "18 of 18", next: null });
  });

  it("goes back through the whole list and stops at the first song", () => {
    const { seen, pos, order } = walk(items, -1);
    expect(seen).toEqual([...titles].reverse());
    expect(step(order, pos, -1)).toBeNull();
  });

  it("labels position and next song", () => {
    const order = playOrder(items);
    expect(playLabel(items, order, 2)).toEqual({ count: "3 of 18", next: "Song 4" });
  });

  it("skips songs that are no longer published, and counts only playable ones", () => {
    const mixed = [item("a", "A"), gone(), item("b", "B"), gone(), item("c", "C")];
    const { seen, order } = walk(mixed);
    expect(seen).toEqual(["A", "B", "C"]);
    expect(playLabel(mixed, order, 0)).toEqual({ count: "1 of 3", next: "B" });
    expect(startPos(order, 2)).toBe(1); // tapped row 3 (B) -> position 2 of 3
    expect(startPos(order, 1)).toBe(0); // tapped an unavailable row -> start
  });

  it("keeps duplicate songs as separate stops", () => {
    const dup = [item("a", "A"), item("b", "B"), item("a", "A", { key: "D" })];
    expect(walk(dup).seen).toEqual(["A", "B", "A"]);
  });

  it("handles a one-song set", () => {
    const one = [item("a", "A")];
    const order = playOrder(one);
    expect(step(order, 0, 1)).toBeNull();
    expect(step(order, 0, -1)).toBeNull();
    expect(playLabel(one, order, 0)).toEqual({ count: "1 of 1", next: null });
  });
});

const chordsOf = (it: SetItem, sessionKey?: string | null) =>
  itemView(it, sessionKey)!.sections.flatMap((s) => s.rows.flat().flatMap((c) => (c.kind === "bar" ? c.beats.map((b) => b.c.root + b.c.qual) : [])));

describe("per-song key override", () => {
  it("shows the chart's own chords without an override", () => {
    expect(chordsOf(item("a", "A"))).toEqual(["G", "C", "D", "G"]);
  });

  it("shows the override key's chords", () => {
    expect(chordsOf(item("a", "A", { key: "D" }))).toEqual(["D", "G", "A", "D"]);
    expect(chordsOf(item("a", "A", { key: "Bb" }))).toEqual(["Bb", "Eb", "F", "Bb"]);
    expect(shownKey(item("a", "A", { key: "D" }))).toBe("D");
  });

  it("an in-session key change wins over the setlist key, without changing the item", () => {
    const it2 = item("a", "A", { key: "D" });
    expect(chordsOf(it2, "E")).toEqual(["E", "A", "B", "E"]);
    expect(it2.key).toBe("D");
  });

  it("ignores an override in the wrong mode (major chart, minor key)", () => {
    const it2 = item("a", "A", { key: "Em" });
    expect(chordsOf(it2)).toEqual(["G", "C", "D", "G"]);
    expect(shownKey(it2)).toBe("G");
  });

  it("works for minor-key seed charts, using the song page's key list", () => {
    const minor = EXAMPLE_CHARTS.find((c) => /\{key: \w+m\}/.test(c.text))!;
    const opts = keyOptions(minor.text);
    expect(opts).toHaveLength(12);
    expect(opts.filter((o) => o.orig)).toHaveLength(1);
    const target = opts.find((o) => !o.orig)!.value;
    const view = itemView({ slug: "m", key: target, note: null, song: song("m", "M", minor.text) })!;
    expect(view.displayKey).toBe(target);
  });
});

describe("notes", () => {
  it("allows short notes", () => expect(noteCheck("start on the chorus")).toEqual({ error: null, warning: null }));
  it("warns past 6 words", () => expect(noteCheck("one two three four five six seven").warning).toMatch(/7 words/));
  it("blocks past 60 characters", () => expect(noteCheck("x".repeat(61)).error).toBeTruthy());
});

describe("snapshot links", () => {
  const snap = {
    name: "Friday · Tootsie's",
    gig_date: "2026-11-20",
    items: [
      { slug: "wagon-wheel", key: "D", note: "start on the chorus" },
      { slug: "friends-in-low-places", key: null, note: null },
      { slug: "wagon-wheel", key: null, note: "reprise" },
    ],
  };

  it("round-trips name, date, keys, notes and order (including unicode)", () => {
    expect(decodeSnapshot(encodeSnapshot(snap))).toEqual(snap);
    expect(decodeSnapshot("#" + encodeSnapshot(snap))).toEqual(snap);
  });

  it("is URL-safe", () => expect(encodeSnapshot(snap)).toMatch(/^[A-Za-z0-9_-]+$/));

  it("keeps 100 songs in a normal-size link and drops anything past 100", () => {
    const big = { ...snap, items: Array.from({ length: 120 }, (_, i) => ({ slug: `song-number-${i}`, key: "Eb", note: "big ending" })) };
    const code = encodeSnapshot(big);
    expect(code.length).toBeLessThan(8000);
    expect(decodeSnapshot(code)!.items).toHaveLength(100);
  });

  it("rejects garbage and drops bad rows", () => {
    expect(decodeSnapshot("not-a-snapshot")).toBeNull();
    const bad = btoa(JSON.stringify({ v: 1, n: "x", d: "tomorrow", i: [["../etc", "H"], ["ok-song", "Zm", "x".repeat(80)], 5] }));
    const d = decodeSnapshot(bad.replace(/=+$/, ""))!;
    expect(d.gig_date).toBeNull();
    expect(d.items).toEqual([{ slug: "ok-song", key: null, note: "x".repeat(60) }]);
  });
});
