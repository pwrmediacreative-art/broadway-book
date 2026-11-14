import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { ago, dueAgain, installKind, nextSince, planSync, sizeLabel, songSig, type SavedSong } from "./plan";
import { offlineTarget, savedSongHref, SHELLS } from "./routes";

const song = (slug: string, chart = "| 1 | 4 |", extra: Partial<SavedSong> = {}): SavedSong => ({
  id: `id-${slug}`,
  slug,
  title: slug,
  artist: null,
  key: "G",
  is_example: false,
  unverified: false,
  updated_at: "2026-11-13T18:00:00Z",
  chart_text: chart,
  ...extra,
});
const savedMap = (songs: SavedSong[]) => new Map(songs.map((s) => [s.slug, songSig(s)]));

describe("planSync", () => {
  it("first download saves everything", () => {
    const all = [song("a"), song("b")];
    const p = planSync(new Map(), ["a", "b"], all);
    expect(p.puts).toHaveLength(2);
    expect(p.deletes).toEqual([]);
  });

  it("counts new + changed + removed, and ignores rows that only differ by timestamp", () => {
    const saved = savedMap([song("a"), song("b"), song("gone")]);
    const incoming = [
      song("a", "| 1 | 5 |"), // changed chart
      song("b", "| 1 | 4 |", { updated_at: "2026-11-13T19:00:00Z" }), // re-sent by the overlap, same content
      song("new"),
    ];
    const p = planSync(saved, ["a", "b", "new"], incoming);
    expect(p.puts.map((s) => s.slug)).toEqual(["a", "new"]);
    expect(p.deletes).toEqual(["gone"]);
    expect(p.updated).toBe(3);
  });

  it("a badge change (Unverified) counts as a change", () => {
    const p = planSync(savedMap([song("a")]), ["a"], [song("a", "| 1 | 4 |", { unverified: true })]);
    expect(p.updated).toBe(1);
  });

  it("nothing changed means no note", () => {
    expect(planSync(savedMap([song("a")]), ["a"], []).updated).toBe(0);
  });

  it("never saves a song that is no longer published", () => {
    const p = planSync(new Map(), ["a"], [song("a"), song("unpublished")]);
    expect(p.puts.map((s) => s.slug)).toEqual(["a"]);
  });
});

describe("sync timing", () => {
  it("next sync starts 5 minutes before this one's server time", () => {
    expect(nextSince("2026-11-13T18:00:00.000Z")).toBe("2026-11-13T17:55:00.000Z");
  });
  it("comes due again after 15 minutes away", () => {
    expect(dueAgain(0, 14 * 60_000)).toBe(false);
    expect(dueAgain(0, 15 * 60_000)).toBe(true);
  });
});

describe("labels", () => {
  it("ago", () => {
    const t = 1_000_000_000;
    expect(ago(t, t + 20_000)).toBe("just now");
    expect(ago(t, t + 5 * 60_000)).toBe("5 min ago");
    expect(ago(t, t + 60 * 60_000)).toBe("1 hour ago");
    expect(ago(t, t + 3 * 60 * 60_000)).toBe("3 hours ago");
    expect(ago(t, t + 2 * 24 * 60 * 60_000)).toBe("2 days ago");
    expect(ago(t, t - 5000)).toBe("just now"); // clock moved back
  });
  it("sizeLabel", () => {
    expect(sizeLabel(5170)).toBe("5 KB");
    expect(sizeLabel(1_150_000)).toBe("1.1 MB");
  });
});

describe("installKind", () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
  const ipad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";
  const android = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36";
  it("picks the right instructions", () => {
    expect(installKind(iphone, 5, false)).toBe("ios");
    expect(installKind(ipad, 5, false)).toBe("ios");
    expect(installKind(ipad, 0, false)).toBe("other"); // a real Mac
    expect(installKind(android, 5, false)).toBe("android");
    expect(installKind(iphone, 5, true)).toBe("installed");
  });
});

describe("offline routes", () => {
  it("saved pages are shown as they are", () => {
    for (const p of SHELLS) expect(offlineTarget(p)).toEqual({ serve: p });
    expect(offlineTarget("/setlists/")).toEqual({ serve: "/setlists" });
  });
  it("songs and stage mode go to the saved-chart page", () => {
    expect(offlineTarget("/songs/wagon-wheel")).toEqual({ redirect: "/offline/song?s=wagon-wheel" });
    expect(offlineTarget("/songs/wagon-wheel/stage")).toEqual({ redirect: "/offline/song?s=wagon-wheel&stage=1" });
  });
  it("account and shared setlists go to the saved-setlist page", () => {
    expect(offlineTarget("/setlists/abc-123")).toEqual({ redirect: "/offline/setlist?id=abc-123" });
    expect(offlineTarget("/setlists/abc-123/play")).toEqual({ redirect: "/offline/setlist?id=abc-123&play=1" });
    expect(offlineTarget("/s/XyZ9")).toEqual({ redirect: "/offline/setlist?code=XyZ9" });
    expect(offlineTarget("/s/XyZ9/play")).toEqual({ redirect: "/offline/setlist?code=XyZ9&play=1" });
  });
  it("the device setlist is a saved page, not an account setlist", () => {
    expect(offlineTarget("/setlists/device")).toEqual({ serve: "/setlists/device" });
    expect(offlineTarget("/setlists/device/play")).toEqual({ serve: "/setlists/device/play" });
  });
  it("server-only pages land on the offline page", () => {
    for (const p of ["/community", "/songs/wagon-wheel/edit", "/songs/wagon-wheel/history", "/admin/review", "/login", "/profile"]) {
      expect(offlineTarget(p)).toEqual({ redirect: `/offline?from=${encodeURIComponent(p)}` });
    }
  });
  it("savedSongHref only takes song links", () => {
    expect(savedSongHref("/songs/jolene/stage")).toBe("/offline/song?s=jolene&stage=1");
    expect(savedSongHref("/")).toBeNull();
    expect(savedSongHref("/songs/jolene/edit")).toBeNull();
    expect(savedSongHref("/setlists/abc")).toBeNull();
  });
});

describe("service worker (public/sw.js)", () => {
  // Load the real file with a stand-in `self`, then read the helpers it exposes.
  const self: Record<string, unknown> = { addEventListener: () => {}, location: { origin: "https://example.test" } };
  vm.runInNewContext(readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8"), { self, URL, Set, Map, Promise, setTimeout, clearTimeout });
  const sw = self.__bb as {
    SHELLS: string[];
    offlineTarget: (p: string) => unknown;
    assetUrls: (html: string) => string[];
    cssUrls: (css: string, base: string) => string[];
  };

  it("uses the same route table as the app", () => {
    expect([...sw.SHELLS]).toEqual(SHELLS);
    const paths = [...SHELLS, "/songs/a", "/songs/a/stage", "/songs/a/edit", "/setlists/x", "/setlists/x/play", "/s/c", "/s/c/play", "/community", "/admin", "/setlists/"];
    for (const p of paths) expect({ ...(sw.offlineTarget(p) as object) }).toEqual(offlineTarget(p));
  });

  it("finds every app file a page mentions", () => {
    const html =
      '<link rel="stylesheet" href="/_next/static/chunks/a1.css?dpl=x&amp;v=2"/><script src="/_next/static/chunks/b2.js" async></script>' +
      '<script>self.__next_f.push([1,"I[1,[\\"/_next/static/chunks/c3.js\\",\\"/_next/static/chunks/b2.js\\"]]"])</script>' +
      '<link rel="preload" href="/_next/static/media/font.p.woff2" as="font"/>';
    expect(sw.assetUrls(html).sort()).toEqual([
      "/_next/static/chunks/a1.css?dpl=x&v=2",
      "/_next/static/chunks/b2.js",
      "/_next/static/chunks/c3.js",
      "/_next/static/media/font.p.woff2",
    ]);
  });

  it("finds the fonts a stylesheet pulls in", () => {
    const css = '@font-face{src:url(../media/inter.woff2) format("woff2")}@font-face{src:url("/_next/static/media/mono.woff2")}.x{background:url(data:image/png;base64,AAAA)}';
    expect(sw.cssUrls(css, "https://example.test/_next/static/chunks/a1.css").sort()).toEqual(["/_next/static/media/inter.woff2", "/_next/static/media/mono.woff2"]);
  });
});
