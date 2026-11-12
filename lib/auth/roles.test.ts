import { describe, expect, it } from "vitest";
import { cleanProfile, parseAdminEmails, roleFor, safeNext } from "./roles";

describe("ADMIN_EMAILS", () => {
  it("unset means don't sync roles", () => {
    expect(parseAdminEmails(undefined)).toBeNull();
    expect(roleFor("a@x.com", null)).toBeNull();
  });
  it("parses commas/spaces, ignores case", () => {
    const admins = parseAdminEmails(" A@x.com, b@Y.com ;c@z.com\n");
    expect(roleFor("a@X.COM", admins)).toBe("admin");
    expect(roleFor("b@y.com", admins)).toBe("admin");
    expect(roleFor("c@z.com", admins)).toBe("admin");
    expect(roleFor("d@z.com", admins)).toBe("contributor");
  });
  it("empty list demotes everyone", () => {
    expect(roleFor("a@x.com", parseAdminEmails(""))).toBe("contributor");
  });
  it("missing email is never admin", () => {
    expect(roleFor(undefined, parseAdminEmails("a@x.com"))).toBe("contributor");
  });
});

describe("profile form", () => {
  it("requires a display name", () => {
    expect(cleanProfile("   ", "")).toEqual({ ok: false, error: "Display name is required." });
  });
  it("trims and collapses spaces; instrument optional", () => {
    expect(cleanProfile("  Steel   Pete ", "")).toEqual({ ok: true, display_name: "Steel Pete", instrument: null });
  });
  it("accepts listed instruments only", () => {
    expect(cleanProfile("Ann", "fiddle")).toMatchObject({ ok: true, instrument: "fiddle" });
    expect(cleanProfile("Ann", "kazoo").ok).toBe(false);
  });
  it("limits name length", () => {
    expect(cleanProfile("x".repeat(41), "").ok).toBe(false);
    expect(cleanProfile("x".repeat(40), "").ok).toBe(true);
  });
});

describe("safeNext", () => {
  it("keeps relative paths, blocks other sites", () => {
    expect(safeNext("/songs/abc")).toBe("/songs/abc");
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("https://evil.com")).toBe("/");
    expect(safeNext("/\\evil.com")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});
