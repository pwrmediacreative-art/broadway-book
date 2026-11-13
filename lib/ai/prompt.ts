// The instructions and output shape for reading one handwritten chart PDF.
// Pure: no SDK, no file access (the format spec is passed in).
import { parseFilename } from "../import/filename";

export const AI_MODEL = "claude-opus-5-5";
export const AI_EFFORT = "medium";
/** Output cap per request, thinking included. Opus medium averaged ~1,700 in the bake-off. */
export const AI_MAX_TOKENS = 8000;

export const READING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["chart_text", "confidence", "unclear", "handwriting", "image_type", "pages", "has_lyrics", "notes"],
  properties: {
    chart_text: { type: "string" },
    confidence: { type: "number" },
    unclear: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["section", "bar", "saw"],
        properties: { section: { type: "string" }, bar: { type: "string" }, saw: { type: "string" } },
      },
    },
    handwriting: { type: "string", enum: ["neat", "mixed", "messy", "typed"] },
    image_type: { type: "string", enum: ["scan", "phone_photo", "digital"] },
    pages: { type: "integer" },
    has_lyrics: { type: "boolean" },
    notes: { type: "string" },
  },
} as const;

export interface UnclearSpot {
  section: string;
  bar: string;
  saw: string;
}
export interface Reading {
  chart_text: string;
  confidence: number;
  unclear: UnclearSpot[];
  handwriting: "neat" | "mixed" | "messy" | "typed";
  image_type: "scan" | "phone_photo" | "digital";
  pages: number;
  has_lyrics: boolean;
  notes: string;
}

export function systemPrompt(formatSpec: string): string {
  return `You transcribe handwritten Nashville Number System charts into the Broadway Book chart format.

Rules, in priority order:
1. NEVER write lyrics. Ignore every lyric line on the page completely. Cue notes are allowed only if they are short performance cues of 6 words or fewer ("band out", "drums only"), never words from the song.
2. NEVER invent. Everything you write must come from the page. When a chord, bar or section is hard to read: write your best reading of what is on the page, put a comment line directly above that chart line in the form "# UNCLEAR: <section> bar <n>: <what you saw>", and add the spot to the "unclear" list. If a bar is truly unreadable, write NC there and flag it the same way. A human reviews every result and fixes the flagged spots.
3. Copy what the page says. Don't fix, simplify or "improve" the arrangement. Keep the chart's own numbering: if a minor-key song counts from 6- (relative major), use {numbers: relative}; if it counts from 1-, use the default minor style. Things the format can't hold (written-out licks, accents, hats, 1st/2nd endings): write the closest plain form and flag it as unclear.
4. Title and artist: use what's written on the chart; if missing, use the filename hint. Key: only what's written; if no key is written, leave out the key tag and add an unclear entry for it.
5. Output canonical text: header tags first, single spaces between bars, " | " between lines, trailing newline. The output must pass the parser described below.

Also report: confidence (0 to 1, how much of the chart you're sure of), handwriting (neat, mixed, messy, typed), image_type (scan, phone_photo, digital), pages (page count), has_lyrics (whether the page shows lyric lines, which you must have skipped) and notes (one short sentence for the reviewer, or empty).

The chart format specification:

${formatSpec}`;
}

export function userText(fileName: string): string {
  const hint = parseFilename(fileName);
  return `Filename: ${fileName}\nFilename hint: title "${hint.title ?? ""}", artist "${hint.artist ?? ""}"\nTranscribe this chart.`;
}

export function retryText(parserError: string): string {
  return `Our parser rejected that chart_text: "${parserError}". Fix only what's needed so it parses, keep every rule (no lyrics, nothing invented, flag unclear spots), and return the full JSON again.`;
}
