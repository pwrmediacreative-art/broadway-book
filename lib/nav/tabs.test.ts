import { describe, expect, it } from "vitest";
import { badge, hidesTabs, tabFor } from "./tabs";

describe("tabs", () => {
  it("lights the tab a page belongs to", () => {
    expect(tabFor("/")).toBe("home");
    expect(tabFor("/songs/jolene")).toBe("home");
    expect(tabFor("/mine/0a1a2dfe-6d92-41ae-b87b-7b61ee79db44")).toBe("home");
    expect(tabFor("/make")).toBe("home");
    expect(tabFor("/make/0a1a2dfe-6d92-41ae-b87b-7b61ee79db44")).toBe("home");
    expect(tabFor("/setlists")).toBe("setlists");
    expect(tabFor("/setlists/abc")).toBe("setlists");
    expect(tabFor("/s/CODE")).toBe("setlists");
    expect(tabFor("/community/123")).toBe("community");
    expect(tabFor("/notifications")).toBe("community");
    expect(tabFor("/settings")).toBe("settings");
    expect(tabFor("/profile/versions")).toBe("settings");
    expect(tabFor("/admin/review/queue")).toBe("settings");
    expect(tabFor("/auth/confirm")).toBeNull();
  });

  it("is hidden on stage, play and print pages only", () => {
    for (const p of ["/songs/jolene/stage", "/mine/x/stage", "/setlists/abc/play", "/setlists/device/play", "/s/CODE/play", "/upload/x/print"])
      expect(hidesTabs(p)).toBe(true);
    for (const p of ["/", "/songs/jolene", "/setlists", "/setlists/abc", "/community", "/settings", "/songs/stage-fright", "/songs/stage", "/songs/play"])
      expect(hidesTabs(p)).toBe(false);
  });

  it("caps the badge", () => {
    expect(badge(3)).toBe("3");
    expect(badge(12)).toBe("9+");
  });
});
