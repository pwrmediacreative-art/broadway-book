// Firm rule (CLAUDE.md): players never see disclaimers about chart accuracy ("check by ear",
// "not yet checked", "this is a draft", "AI-generated, may be wrong", ...), and never an AI
// confidence score ("NN% sure", "AI read: 80%", "(estimated)"). Players may see the Unverified
// badge and unclear-bar marks as plain data; only admin screens show confidence.
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

/** A confidence score shown to players, written out or built from a 0–1 value (Q15). */
export const CONFIDENCE: RegExp[] = [
  /%\s*(?:sure|confident|confidence|certain)\b/i,
  /\bconfiden(?:ce|t)\s*:?\s*\d+\s*%/i,
  /\b(?:ai|machine)\s+read\s*:/i,
  /confiden\w*\s*\*\s*100\b/i,
  /\(\s*estimated\b/i,
  /\bsureLabel\b/,
];

function scan(paths: string[], patterns: RegExp[]): string[] {
  const hits: string[] = [];
  for (const p of paths) {
    const lines = readFileSync(p, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const re of patterns) if (re.test(line)) hits.push(`${relative(ROOT, p)}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  return hits;
}

describe("no disclaimers for players", () => {
  const scanned = [...files(join(ROOT, "app")), ...files(join(ROOT, "lib")), ...files(join(ROOT, "public"))].filter(
    (p) => !SKIP.some((s) => relative(ROOT, p).startsWith(s)),
  );

  it("scans the player-facing code", () => {
    expect(scanned.length).toBeGreaterThan(50);
  });

  it("no banned phrase appears in player-facing code or copy", () => {
    expect(scan(scanned, BANNED)).toEqual([]);
  });

  it("no confidence score appears in player-facing code or copy", () => {
    expect(scan(scanned, CONFIDENCE)).toEqual([]);
  });

  it("the patterns catch the old wording", () => {
    for (const s of ["Play it by ear and suggest a fix", "check it by ear", "Check every bar by ear", "Not yet checked against the original", "AI-generated, may be wrong", "this is a draft"]) {
      expect(BANNED.some((re) => re.test(s))).toBe(true);
    }
  });

  it("the confidence patterns catch the old wording", () => {
    for (const s of [
      "75% sure",
      "{sure && <span>{sure}</span>} 80 % sure",
      "AI read: 82% sure",
      "`${Math.round(m.confidence * 100)}% sure (estimated)`",
      "`${Math.round(info.confidence * 100)}%`",
      "(estimated from the timing)",
      "Confidence: 80%",
      "90% confident",
      "sureLabel(confidence)",
    ]) {
      expect(CONFIDENCE.some((re) => re.test(s)), s).toBe(true);
    }
    for (const s of ["Uploading audio 40%", "Confirmed by 3 players", "Unverified", "2 spots to fill in", "Are You Sure Hank Done It This Way"]) {
      expect(CONFIDENCE.some((re) => re.test(s)), s).toBe(false);
    }
  });
});
