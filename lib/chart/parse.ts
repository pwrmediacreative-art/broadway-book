import { parseKey } from "./transpose";
import {
  SECTION_NAMES,
  type BeatItem,
  type ChartDoc,
  type ChartMeta,
  type Degree,
  type Line,
  type Row,
  type RowItem,
  type SectionLabel,
  type SectionName,
  type Tag,
} from "./types";

export class ChartParseError extends Error {
  constructor(
    message: string,
    public line: number,
  ) {
    super(`Line ${line}: ${message}`);
    this.name = "ChartParseError";
  }
}

export interface ParseResult {
  doc: ChartDoc;
  warnings: string[];
}

export const HEADER_TAGS = [
  "title",
  "artist",
  "key",
  "bpm",
  "time",
  "feel",
  "tags",
  "numbers",
] as const;
export const INLINE_TAGS = ["key", "bpm", "time", "feel", "mod"] as const;

const MAX_CUE_WORDS = 6;

// Chord quality vocabulary (after the degree). Everything optional, fixed order.
const QUALITY =
  "-?(?:maj7|maj9|dim7|dim|aug|\\+)?(?:2|4|6|7|9|11|13)?(?:sus[24]?)?(?:add(?:2|4|9|11|13))?(?:[b#](?:5|9|11|13))*";
const CHORD_RE = new RegExp(
  `^(\\^)?(<)?(?:(NC)|([b#]?)([1-7])(${QUALITY})(?:/([b#]?)([1-7]))?)(>)?([~!])?$`,
);
const SECTION_RE = new RegExp(
  `^(${SECTION_NAMES.join("|")})(\\d+)?(?:\\s+x(\\d+))?$`,
);
const TAG_RE = /^\{([a-z]+):\s*([^{}]*?)\s*\}$/;

/** Split on a separator (whitespace or "|") outside quotes, braces and parens. */
function splitTop(s: string, sep: "space" | "bar", lineNo: number): string[] {
  const out: string[] = [];
  let cur = "";
  let quote = false;
  let brace = 0;
  let paren = 0;
  for (const ch of s) {
    if (ch === '"') quote = !quote;
    else if (!quote) {
      if (ch === "{") brace++;
      else if (ch === "}") brace--;
      else if (ch === "(") paren++;
      else if (ch === ")") paren--;
      if (brace < 0 || paren < 0)
        throw new ChartParseError(`unexpected "${ch}"`, lineNo);
    }
    const isSep =
      !quote &&
      brace === 0 &&
      paren === 0 &&
      (sep === "space" ? /\s/.test(ch) : ch === "|");
    if (isSep) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (quote) throw new ChartParseError("unclosed quote", lineNo);
  if (brace) throw new ChartParseError('unclosed "{"', lineNo);
  if (paren) throw new ChartParseError('unclosed "("', lineNo);
  out.push(cur);
  return sep === "space" ? out.filter((t) => t !== "") : out.map((t) => t.trim());
}

function validateTag(
  name: string,
  value: string,
  where: "header" | "inline",
  lineNo: number,
): void {
  const allowed: readonly string[] = where === "header" ? HEADER_TAGS : INLINE_TAGS;
  if (!allowed.includes(name)) {
    throw new ChartParseError(
      `unknown ${where === "header" ? "" : "in-chart "}tag {${name}:}. Allowed: ${allowed.join(", ")}`,
      lineNo,
    );
  }
  const bad = (why: string) =>
    new ChartParseError(`{${name}: ${value}} ${why}`, lineNo);
  if (name === "key" && !parseKey(value))
    throw bad("is not a key (use A, Bb, F#, Am, C#m...)");
  if (name === "bpm" && !/^\d{2,3}$/.test(value)) throw bad("must be a number");
  if (name === "time" && !/^\d{1,2}\/\d{1,2}$/.test(value))
    throw bad("must look like 4/4");
  if (name === "mod" && !/^[+-]\d{1,2}$/.test(value))
    throw bad("must look like +1 or -2 (half steps)");
  if (name === "numbers" && value !== "relative" && value !== "minor")
    throw bad('must be "relative" or "minor"');
}

function parseTag(tok: string, where: "header" | "inline", lineNo: number): Tag {
  const m = TAG_RE.exec(tok);
  if (!m) throw new ChartParseError(`bad tag "${tok}" (use {name: value})`, lineNo);
  const [, name, value] = m;
  validateTag(name, value, where, lineNo);
  return { name, value };
}

function deg(acc: string | undefined, d: string): Degree {
  return { acc: (acc ?? "") as Degree["acc"], degree: Number(d) };
}

function parseBeat(tok: string, lineNo: number): BeatItem {
  if (tok === "%") return { kind: "repeat" };
  const m = CHORD_RE.exec(tok);
  if (!m || Boolean(m[2]) !== Boolean(m[9])) {
    throw new ChartParseError(`can't read "${tok}"`, lineNo);
  }
  const [, push, diamond, nc, acc, degree, quality, bassAcc, bassDeg, , end] = m;
  const mods = {
    push: Boolean(push),
    diamond: Boolean(diamond),
    end: end === "~" ? ("fermata" as const) : end === "!" ? ("stop" as const) : ("" as const),
  };
  if (nc) return { kind: "nc", ...mods };
  return {
    kind: "chord",
    root: deg(acc, degree),
    quality: quality ?? "",
    bass: bassDeg ? deg(bassAcc, bassDeg) : null,
    ...mods,
  };
}

function parseItem(tok: string, lineNo: number, warnings: string[]): RowItem {
  if (tok.startsWith('"')) {
    const m = /^"([^"]+)"$/.exec(tok);
    if (!m) throw new ChartParseError(`bad cue ${tok}`, lineNo);
    const text = m[1].trim();
    if (text.split(/\s+/).length > MAX_CUE_WORDS)
      warnings.push(`Line ${lineNo}: cue "${text}" is long. Keep cues short, no lyrics.`);
    return { kind: "cue", text };
  }
  if (tok.startsWith("{")) return { kind: "tag", ...parseTag(tok, "inline", lineNo) };
  if (tok === "<<") return { kind: "dynamic", value: "cresc" };
  if (tok === ">>") return { kind: "dynamic", value: "decresc" };
  if (tok.startsWith("(")) {
    if (!tok.endsWith(")")) throw new ChartParseError(`bad split bar ${tok}`, lineNo);
    const inner = tok.slice(1, -1);
    if (/[()]/.test(inner)) throw new ChartParseError("split bars can't nest", lineNo);
    const beats = splitTop(inner, "space", lineNo).map((t) => parseBeat(t, lineNo));
    if (beats.length < 2)
      throw new ChartParseError("a split bar needs 2 or more chords: (1 4)", lineNo);
    return { kind: "split", beats };
  }
  return parseBeat(tok, lineNo);
}

function parseRows(s: string, lineNo: number, warnings: string[]): Row[] {
  if (s.trim() === "") return [];
  return splitTop(s, "bar", lineNo).map((part) => {
    if (part === "") throw new ChartParseError('empty line between "|"', lineNo);
    return splitTop(part, "space", lineNo).map((t) => parseItem(t, lineNo, warnings));
  });
}

function parseSectionLabel(inner: string, lineNo: number): SectionLabel {
  const m = SECTION_RE.exec(inner.trim());
  if (!m) {
    throw new ChartParseError(
      `unknown section [${inner}]. Use ${SECTION_NAMES.map((n) => `[${n}]`).join(" ")}, optionally numbered [V2] or repeated [C x2]`,
      lineNo,
    );
  }
  return {
    name: m[1] as SectionName,
    number: m[2] ? Number(m[2]) : null,
    repeat: m[3] ? Number(m[3]) : null,
  };
}

export function parseChart(text: string): ParseResult {
  const warnings: string[] = [];
  const lines: Line[] = [];
  const raw = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  let seenSection = false;

  raw.forEach((rawLine, i) => {
    const lineNo = i + 1;
    const line = rawLine.trim();
    if (line === "") {
      lines.push({ kind: "blank" });
      return;
    }
    if (line.startsWith("#")) {
      lines.push({ kind: "comment", text: line.slice(1).trim() });
      return;
    }
    if (line.startsWith("[")) {
      const close = line.indexOf("]");
      if (close < 0) throw new ChartParseError('missing "]"', lineNo);
      const section = parseSectionLabel(line.slice(1, close), lineNo);
      seenSection = true;
      lines.push({ kind: "section", section, rows: parseRows(line.slice(close + 1), lineNo, warnings) });
      return;
    }
    const toks = splitTop(line, "space", lineNo);
    if (toks.every((t) => t.startsWith("{") && t.endsWith("}"))) {
      const where = seenSection ? "inline" : "header";
      lines.push({ kind: "tags", tags: toks.map((t) => parseTag(t, where, lineNo)) });
      return;
    }
    if (!seenSection)
      throw new ChartParseError("bars must come after a section label like [V]", lineNo);
    lines.push({ kind: "rows", rows: parseRows(line, lineNo, warnings) });
  });

  const doc: ChartDoc = { version: 1, lines };
  const meta = getMeta(doc);
  if (!meta.title) warnings.push("Missing {title:}");
  if (!meta.key) warnings.push("Missing {key:}");
  return { doc, warnings };
}

/** Header tags (before the first section). */
export function getMeta(doc: ChartDoc): ChartMeta {
  const meta: ChartMeta = {
    title: null,
    artist: null,
    key: null,
    bpm: null,
    time: null,
    feel: null,
    tags: [],
    numbers: "minor",
  };
  for (const line of doc.lines) {
    if (line.kind === "section") break;
    if (line.kind !== "tags") continue;
    for (const { name, value } of line.tags) {
      if (name === "title") meta.title = value;
      else if (name === "artist") meta.artist = value;
      else if (name === "key") meta.key = value;
      else if (name === "bpm") meta.bpm = Number(value);
      else if (name === "time") meta.time = value;
      else if (name === "feel") meta.feel = value;
      else if (name === "numbers") meta.numbers = value as ChartMeta["numbers"];
      else if (name === "tags")
        meta.tags = value.split(",").map((t) => t.trim()).filter(Boolean);
    }
  }
  return meta;
}
