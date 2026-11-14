// Keeps screens on the DESIGN.md tokens: no hex, raw Tailwind colors, old token names,
// pill/card rounding, shadows, blur or text under 14px in components.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HEX } from "./tokens";

const ROOT = join(__dirname, "..", "..");
const css = readFileSync(join(ROOT, "app", "globals.css"), "utf8");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(tsx|ts)$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : [];
  });
}

const PALETTE =
  "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black|white";
const RULES: [string, RegExp][] = [
  ["hex color", /["'`(\s:,]#[0-9a-fA-F]{3,8}\b/],
  ["raw Tailwind color", new RegExp(`(?<![\\w-])(?:bg|text|border(?:-[trblxy])?|ring|ring-offset|outline|divide|fill|stroke|placeholder|decoration|accent|caret|from|to|via|shadow)-(?:${PALETTE})(?:-\\d+)?(?![\\w-])`)],
  ["old token", /var\(--(?:background|foreground|muted|accent|panel|line)\)|(?<![\w-])(?:bg|text|border|ring|outline|divide|placeholder|accent)-(?:background|foreground|muted|accent|panel|line)(?![\w-])/],
  ["rounding (use rounded-bb-control / rounded-bb-none / bb-dot)", /(?<![\w-])rounded(?:-[trblse]{1,2})?(?:-(?:sm|md|lg|xl|2xl|3xl|full))?(?=["'`\s])/],
  ["shadow", /(?<![\w-])shadow(?:-(?:sm|md|lg|xl|2xl|inner))?(?=["'`\s])/],
  ["blur / glass", /(?<![\w-])(?:backdrop-)?blur(?:-\w+)?(?=["'`\s])/],
  ["gradient", /(?<![\w-])bg-(?:linear|gradient|radial|conic)-/],
  ["raw font family class (use font-bb-ui / font-bb-data / font-bb-chart)", /(?<![\w-])font-(?:sans|serif|mono)(?![\w-])/],
  ["text under 14px", /(?<![\w-])text-(?:xs|\[(?:0\.[0-7]\d*rem|(?:[0-9]|1[0-3])px)\])(?![\w-])/],
];

describe("design tokens", () => {
  it("hex mirror matches globals.css", () => {
    expect(css).toContain(`--bb-color-house-black: ${HEX.houseBlack};`);
  });

  it("old token names are retired", () => {
    expect(css).not.toMatch(/--(?:background|foreground|muted|accent|panel|line):/);
  });

  const all = [...files(join(ROOT, "app")), ...files(join(ROOT, "lib"))].filter((f) => !f.endsWith(join("design", "tokens.ts")));
  for (const [name, re] of RULES) {
    it(`no ${name} in components`, () => {
      const hits: string[] = [];
      for (const f of all) {
        readFileSync(f, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (re.test(line)) hits.push(`${f.slice(ROOT.length + 1)}:${i + 1}: ${line.trim().slice(0, 120)}`);
          });
      }
      expect(hits).toEqual([]);
    });
  }
});
