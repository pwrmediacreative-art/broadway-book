import { describe, expect, it } from "vitest";
import { isDisplay, newer } from "./display-rule";

const d = (v: "numbers" | "chords" | null, at: string | null) => ({ v, at });

describe("Numbers/Chords: device vs account, latest change wins", () => {
  it("same choice: nothing to do", () => {
    expect(newer(d("chords", "2026-01-01"), d("chords", "2026-02-01"))).toBe("same");
  });
  it("newer side wins", () => {
    expect(newer(d("chords", "2026-03-01T10:00:00Z"), d("numbers", "2026-03-01T09:00:00Z"))).toBe("device");
    expect(newer(d("chords", "2026-03-01T09:00:00Z"), d("numbers", "2026-03-01T10:00:00Z"))).toBe("account");
  });
  it("a side with no choice never wins", () => {
    expect(newer(d(null, null), d("chords", "2026-01-01"))).toBe("account");
    expect(newer(d("numbers", null), d(null, null))).toBe("device");
  });
  it("a device choice from before timestamps existed loses to a dated account choice", () => {
    expect(newer(d("numbers", null), d("chords", "2026-01-01"))).toBe("account");
  });
  it("only numbers/chords are valid", () => {
    expect(isDisplay("chords")).toBe(true);
    expect(isDisplay("abc")).toBe(false);
  });
});
