import { describe, expect, it } from "vitest";
import { CONFIRMED_LINE_MIN, confirmedLine, readConfirmState, sureLabel } from "./confirm";

describe("sureLabel", () => {
  it("rounds the stored score to a whole percent", () => {
    expect(sureLabel(0.75)).toBe("75% sure");
    expect(sureLabel("0.25")).toBe("25% sure");
    expect(sureLabel(0.905)).toBe("91% sure");
  });
  it("clamps and never mentions AI", () => {
    expect(sureLabel(1.4)).toBe("100% sure");
    expect(sureLabel(-1)).toBe("0% sure");
    expect(sureLabel(0.5)).not.toMatch(/ai/i);
  });
  it("shows nothing without a score", () => {
    expect(sureLabel(null)).toBeNull();
    expect(sureLabel(undefined)).toBeNull();
    expect(sureLabel("")).toBeNull();
    expect(sureLabel("x")).toBeNull();
  });
});

describe("confirmedLine", () => {
  it(`starts at ${CONFIRMED_LINE_MIN} players`, () => {
    expect(CONFIRMED_LINE_MIN).toBe(3);
    expect(confirmedLine(0)).toBeNull();
    expect(confirmedLine(2)).toBeNull();
    expect(confirmedLine(3)).toBe("Confirmed by 3 players");
    expect(confirmedLine(12)).toBe("Confirmed by 12 players");
    expect(confirmedLine(null)).toBeNull();
  });
});

describe("readConfirmState", () => {
  it("reads the database reply", () => {
    expect(readConfirmState({ count: 4, mine: true })).toEqual({ count: 4, mine: true });
    expect(readConfirmState({ count: "2", mine: false })).toEqual({ count: 2, mine: false });
    expect(readConfirmState({ count: 1 })).toEqual({ count: 1, mine: false });
  });
  it("rejects anything else", () => {
    expect(readConfirmState(null)).toBeNull();
    expect(readConfirmState({ count: -1 })).toBeNull();
    expect(readConfirmState({ count: 1.5 })).toBeNull();
    expect(readConfirmState("x")).toBeNull();
  });
});
