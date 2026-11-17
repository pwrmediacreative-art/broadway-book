import { describe, expect, it } from "vitest";
import { isMatch, lrcToPlain, lyricsText, norm, pickBest, type LyricsRecord } from "./match";

const rec = (id: number, trackName: string, artistName: string, extra: Partial<LyricsRecord> = {}): LyricsRecord => ({
  id,
  trackName,
  artistName,
  plainLyrics: "la la",
  ...extra,
});

describe("lyrics matching (auto-pick, else nothing)", () => {
  it("normalizes titles", () => {
    expect(norm("(Don't Take Her) She's All I Got")).toBe("she s all i got");
    expect(norm("Beer For My Horses (feat. Willie Nelson)")).toBe("beer for my horses");
    expect(norm("Brad Paisley & Alison Krauss")).toBe("brad paisley and alison krauss");
  });
  it("matches close titles and artists, not other songs", () => {
    expect(isMatch("Beer For My Horses", "Toby Keith", rec(1, "Beer for My Horses", "Toby Keith & Willie Nelson"))).toBe(true);
    expect(isMatch("Whiskey", "Jana Kramer", rec(2, "Whiskey River", "Willie Nelson"))).toBe(false);
    expect(isMatch("Whiskey", "Jana Kramer", rec(3, "Whiskey", "Marissa Stout"))).toBe(false);
  });
  it("picks the exact title first and skips instrumentals and empty records", () => {
    const list = [
      rec(1, "Wagon Wheel (Live)", "Old Crow Medicine Show"),
      rec(2, "Wagon Wheel", "Old Crow Medicine Show", { instrumental: true, plainLyrics: null }),
      rec(3, "Wagon Wheel", "Old Crow Medicine Show"),
    ];
    expect(pickBest("Wagon Wheel", "Old Crow Medicine Show", list)?.id).toBe(3);
    expect(pickBest("Nothing Like It", "Nobody", list)).toBeNull();
  });
  it("shows synced lyrics as plain text, without timestamps", () => {
    expect(lrcToPlain("[ar: X]\n[00:01.20] Line one\n[00:03.5]Line two\n\n\n[00:09.00] Line three")).toBe("Line one\nLine two\n\nLine three");
    expect(lyricsText(rec(1, "a", "b", { plainLyrics: null, syncedLyrics: "[00:01.00] Hi" }))).toBe("Hi");
    expect(lyricsText(rec(1, "a", "b", { plainLyrics: null, syncedLyrics: null }))).toBeNull();
  });
});
