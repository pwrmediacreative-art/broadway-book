// Firm rule (CLAUDE.md): players never see disclaimers about chart accuracy ("check by ear",
// "not yet checked", "this is a draft", "AI-generated, may be wrong", ...). Accuracy info
// (confidence, unclear bars, Unverified) is shown as data, and only admin screens explain it.
// This scans every player-facing source file and fails if a banned phrase comes back.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");

/** Admin screens, the AI reading prompts (never shown to players) and tests are allowed. */
const SKIP = [
  `app${sep}admin${sep}`,
  `lib${sep}ai${sep}`,
  `lib${sep}review${sep}`,
  `lib${sep}design${sep}no-disclaimers.test.ts`,
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" ? [] : files(p);
    return /\.(tsx?|jsx?|md|json)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

export const BANNED: RegExp[] = [
  /check(?:ing)?\s+(?:it\s+|every\s+bar\s+|each\s+bar\s+)?by\s+ear/i,
  /play\s+it\s+by\s+ear/i,
  /\bby\s+ear\b/i,
  /not\s+yet\s+checked/i,
  /not\s+checked\s+against/i,
  /this\s+is\s+(?:a|not\s+a)\s+(?:draft|finished)/i,
  /\bdraft\s+chart\b/i,
  /ai[\s-]generated/i,
  /may\s+be\s+wrong/i,
  /might\s+be\s+(?:wrong|off)/i,
  /use\s+with\s+caution/i,
  /please\s+verify/i,
  /double[\s-]check/i,
  /may\s+contain\s+errors/i,
  /not\s+guaranteed/i,
  /auto[\s-]generated/i,
  /machine[\s-]read/i,
  /might\s+not\s+be\s+right/i,
  /check\s+the\s+key/i,
];

describe("no disclaimers for players", () => {
  const scanned = [...files(join(ROOT, "app")), ...files(join(ROOT, "lib")), ...files(join(ROOT, "public"))].filter(
    (p) => !SKIP.some((s) => relative(ROOT, p).startsWith(s)),
  );

  it("scans the player-facing code", () => {
    expect(scanned.length).toBeGreaterThan(50);
  });

  it("no banned phrase appears in player-facing code or copy", () => {
    const hits: string[] = [];
    for (const p of scanned) {
      const lines = readFileSync(p, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const re of BANNED) if (re.test(line)) hits.push(`${relative(ROOT, p)}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("the patterns catch the old wording", () => {
    for (const s of ["Play it by ear and suggest a fix", "check it by ear", "Check every bar by ear", "Not yet checked against the original", "AI-generated, may be wrong", "this is a draft"]) {
      expect(BANNED.some((re) => re.test(s))).toBe(true);
    }
  });
});
