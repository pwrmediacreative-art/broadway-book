import { describe, expect, it } from "vitest";
import { CONFIRMED_LINE_MIN, confirmedLine, readConfirmState } from "./confirm";

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
