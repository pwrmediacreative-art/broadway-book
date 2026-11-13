import "server-only";

/**
 * Reads handwritten chart PDFs with Claude. SERVER ONLY: uses ANTHROPIC_API_KEY.
 * Standard API for the pilot (results in a minute), Message Batches (half price) for
 * the full run. Every reply goes through our parser; a parse failure gets one retry
 * with the parser error. Spending limits live in the database (ai_reserve).
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import path from "node:path";
import { temporaryLink } from "@/lib/dropbox/client";
import { costUsd } from "./cost";
import { AI_EFFORT, AI_MAX_TOKENS, AI_MODEL, READING_SCHEMA, retryText, systemPrompt, userText } from "./prompt";
import { finishPayload, finishStatus, interpret, noTokens, type FinishStatus, type Outcome, type Tokens } from "./result";

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** MAX_AI_SPEND_USD, or 0 (nothing may be spent) when unset or invalid. */
export function spendCap(): number {
  const n = Number(process.env.MAX_AI_SPEND_USD);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  client ??= new Anthropic({ maxRetries: 3, timeout: 150_000 });
  return client;
}

let system: string | null = null;
function systemText(): string {
  // docs/CHART_FORMAT.md is traced into the deployment (next.config outputFileTracingIncludes).
  system ??= systemPrompt(readFileSync(path.join(process.cwd(), "docs/CHART_FORMAT.md"), "utf8"));
  return system;
}

const MAX_PDF_BYTES = 30 * 1024 * 1024;

/** Fetch one PDF from Dropbox as base64. Nothing is written to disk. */
export async function downloadPdf(pathOrId: string): Promise<string> {
  const link = await temporaryLink(pathOrId);
  const res = await fetch(link, { cache: "no-store" });
  if (!res.ok) throw new Error(`Dropbox download failed (${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_PDF_BYTES) throw new Error("PDF is over 30 MB.");
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("File isn't a PDF.");
  return buf.toString("base64");
}

export type Params = Anthropic.MessageCreateParamsNonStreaming;

export function requestParams(pdfB64: string, fileName: string): Params {
  return {
    model: AI_MODEL,
    max_tokens: AI_MAX_TOKENS,
    system: [{ type: "text", text: systemText(), cache_control: { type: "ephemeral" } }],
    output_config: { effort: AI_EFFORT, format: { type: "json_schema", schema: READING_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfB64 } },
          { type: "text", text: userText(fileName) },
        ],
      },
    ],
  } as Params;
}

export interface ReadResult {
  status: FinishStatus;
  payload: ReturnType<typeof finishPayload>;
}

function addUsage(t: Tokens, u: Anthropic.Usage) {
  t.input_tokens += u.input_tokens;
  t.output_tokens += u.output_tokens;
  t.cache_read_tokens += u.cache_read_input_tokens ?? 0;
  t.cache_write_tokens += u.cache_creation_input_tokens ?? 0;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

/**
 * Given the first reply (standard or batch), retry once on a parser error.
 * reserveRetry() must return true before the retry is sent (the spend cap check).
 * getParams() rebuilds the original request (a batch retry re-downloads the PDF).
 */
export async function finishReading(
  first: Anthropic.Message,
  batch: boolean,
  getParams: () => Promise<Params>,
  reserveRetry: () => Promise<boolean>,
): Promise<ReadResult> {
  const tokens = noTokens();
  addUsage(tokens, first.usage);
  let cost = costUsd(first.usage, batch);
  let o: Outcome = interpret(first);
  let retried = false;

  if (o.kind === "parse_error") {
    const firstTry = o;
    const firstError = o.error;
    if (!(await reserveRetry())) {
      o = { ...firstTry, error: `${firstError} (no budget left for a retry)` };
    } else {
      retried = true;
      try {
        const params = await getParams();
        const second = await anthropic().messages.create({
          ...params,
          messages: [
            ...params.messages,
            { role: "assistant", content: first.content },
            { role: "user", content: retryText(firstError) },
          ],
        });
        addUsage(tokens, second.usage);
        cost += costUsd(second.usage, false);
        o = interpret(second);
      } catch (e) {
        // Keep the first reading for the human; it ends as needs_manual.
        o = { ...firstTry, error: `${firstError} (retry failed: ${message(e)})` };
      }
    }
  }
  return { status: finishStatus(o, retried), payload: finishPayload(o, cost, tokens) };
}

/** Standard API: read one PDF now (pilot). */
export async function readNow(pdfB64: string, fileName: string, reserveRetry: () => Promise<boolean>): Promise<ReadResult> {
  const params = requestParams(pdfB64, fileName);
  let first: Anthropic.Message;
  try {
    first = await anthropic().messages.create(params);
  } catch (e) {
    // The API failed before replying: nothing billed, the file can be read again.
    return { status: "error", payload: finishPayload({ kind: "error", error: message(e) }, 0, noTokens()) };
  }
  return finishReading(first, false, async () => params, reserveRetry);
}

/** Message Batches: send many at half price. Returns the batch id. */
export async function createBatch(items: { id: string; pdfB64: string; fileName: string }[]): Promise<string> {
  const batch = await anthropic().messages.batches.create({
    requests: items.map((it) => ({ custom_id: it.id, params: requestParams(it.pdfB64, it.fileName) })),
  });
  return batch.id;
}

export async function batchEnded(batchId: string): Promise<boolean> {
  const b = await anthropic().messages.batches.retrieve(batchId);
  return b.processing_status === "ended";
}

export async function batchResults(batchId: string) {
  return anthropic().messages.batches.results(batchId);
}
