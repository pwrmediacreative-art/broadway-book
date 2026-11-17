import { describe, expect, it } from "vitest";
import { dayLabel, flagHref, groupNotes, type NoteFlag, type NoteVersion } from "./group";

const flag = (id: string, slug: string, section: number, bar: number, at: string): NoteFlag => ({
  id,
  slug,
  ref: { section, label: "V", bar, beat: 0, text: "4" },
  note: null,
  created_at: at,
});
const names = (slug: string) => ({ title: slug.toUpperCase(), artist: "X" });
const v = (slug: string, at: string): NoteVersion => ({ slug, title: "Mine " + slug, artist: null, updated_at: at, stale: false });

describe("My notes (option B)", () => {
  const flags = [flag("1", "a", 1, 3, "2026-11-10T10:00:00Z"), flag("2", "b", 0, 1, "2026-11-12T10:00:00Z"), flag("3", "a", 0, 2, "2026-11-11T10:00:00Z")];
  it("groups by song, newest song first, flags in chart order", () => {
    const g = groupNotes(flags, [], names);
    expect(g.map((x) => x.slug)).toEqual(["b", "a"]);
    expect(g[1].flags.map((f) => f.id)).toEqual(["3", "1"]);
    expect(g[1].latest).toBe("2026-11-11T10:00:00Z");
  });
  it("a version edit counts as activity and joins the song's group", () => {
    const g = groupNotes(flags, [v("a", "2026-11-13T00:00:00Z"), v("c", "2026-11-01T00:00:00Z")], names);
    expect(g.map((x) => x.slug)).toEqual(["a", "b", "c"]);
    expect(g[0].version?.slug).toBe("a");
    expect(g[2].title).toBe("Mine c");
  });
  it("filters: flags only, versions only", () => {
    expect(groupNotes(flags, [v("c", "2026-11-01T00:00:00Z")], names, "flags").map((x) => x.slug)).toEqual(["b", "a"]);
    expect(groupNotes(flags, [v("c", "2026-11-01T00:00:00Z")], names, "versions").map((x) => x.slug)).toEqual(["c"]);
  });
  it("labels days and links to the spot", () => {
    const now = new Date(2026, 10, 16, 21, 0);
    expect(dayLabel(new Date(2026, 10, 16, 9).toISOString(), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 10, 15, 23).toISOString(), now)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 10, 12).toISOString(), now)).toBe("Nov 12");
    expect(flagHref(flags[0])).toBe("/songs/a#at=1.3.0");
  });
});
