"use server";

import { revalidatePath, updateTag } from "next/cache";
import { dropboxConfigured } from "@/lib/dropbox/client";
import { worstCaseRetryUsd, worstCaseUsd } from "@/lib/ai/cost";
import { pickVaried, takeChunk, type Candidate } from "@/lib/ai/pick";
import { AI_MODEL } from "@/lib/ai/prompt";
import { finishPayload, noTokens } from "@/lib/ai/result";
import {
  aiConfigured,
  batchEnded,
  batchResults,
  createBatch,
  downloadPdf,
  finishReading,
  readNow,
  requestParams,
  spendCap,
} from "@/lib/ai/reader";
import { SONGS_TAG } from "@/lib/supabase/server";
import { getCurrentUser, sessionClient } from "@/lib/supabase/session";

export interface AiState {
  ok?: boolean;
  error?: string;
  summary?: string;
  /** Full batch loop: anything left to send, and is anything still out? */
  more?: boolean;
  open?: number;
  capped?: boolean;
  /** The first full-batch chunk is waiting for an admin to check it. */
  paused?: boolean;
}

const PILOT_SIZE = 20;
const CHUNK = 25; // PDFs per Message Batch (most scans are 60–470 KB)
const CHUNK_BYTES = 100 * 1024 * 1024; // and at most this much PDF per batch (the API takes 256 MB)
const MAX_OPEN_BATCHES = 8; // batches out at once, so a bad stretch only ties up 200 files
const PARALLEL = 5;
const TIME_BUDGET_MS = 240_000; // stay under the page's maxDuration (300 s)

type Db = Awaited<ReturnType<typeof sessionClient>>;
interface Reserved {
  reading_id: string;
  dropbox: string;
  file_name: string | null;
  size: number | null;
}

async function ready(): Promise<{ db: Db; cap: number } | { error: string }> {
  const user = await getCurrentUser();
  if (user?.role !== "admin") return { error: "Admins only." };
  if (!dropboxConfigured()) return { error: "Dropbox isn't connected yet." };
  if (!aiConfigured()) return { error: "ANTHROPIC_API_KEY isn't set on the server." };
  const cap = spendCap();
  if (!cap) return { error: "MAX_AI_SPEND_USD isn't set on the server, so nothing may be spent." };
  const db = await sessionClient();
  const { error } = await db.rpc("ai_expire_stale");
  if (error) return { error: error.message };
  return { db, cap };
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);
const usd = (n: number) => `$${n.toFixed(2)}`;

async function candidates(db: Db): Promise<Candidate[]> {
  const { data, error } = await db.rpc("ai_candidates");
  if (error) throw new Error(error.message);
  return (data ?? []) as Candidate[];
}

async function reserve(db: Db, picks: Candidate[], mode: "pilot" | "batch", cap: number) {
  const { data, error } = await db.rpc("ai_reserve", {
    p_items: picks.map((c) => ({ import_file_id: c.id, est_usd: worstCaseUsd(c.size, mode === "batch") })),
    p_mode: mode,
    p_model: AI_MODEL,
    p_cap: cap,
  });
  if (error) throw new Error(error.message);
  return data as { reserved: Reserved[]; capped: boolean; skipped: number; spent: number };
}

const retryReserver = (db: Db, r: Reserved, cap: number) => async () => {
  const { data, error } = await db.rpc("ai_reserve_more", {
    p_id: r.reading_id,
    p_est: worstCaseRetryUsd(r.size),
    p_cap: cap,
  });
  return !error && data === true;
};

async function finish(db: Db, id: string, status: string, payload: object) {
  const { error } = await db.rpc("ai_finish", { p_id: id, p_status: status, p_result: payload });
  if (error) throw new Error(`Couldn't save a result: ${error.message}`);
}

/**
 * With auto-approve on, ai_finish may have put charts live (the database decides which).
 * Refresh the cached public song reads (home list, search index) the same way a publish
 * does; phones pick the charts up on their next offline sync, which isn't cached.
 * Off: nothing went live, so nothing to refresh.
 */
async function refreshIfAutoApproved(db: Db, saved: number) {
  if (!saved) return;
  const { data } = await db.from("settings").select("value").eq("key", "auto_approve_enabled");
  if (data?.[0]?.value === 1) updateTag(SONGS_TAG);
}

/** Read 20 varied files now on the standard API, show them, and stop. */
export async function runPilot(prev: AiState): Promise<AiState> {
  void prev;
  const r = await ready();
  if ("error" in r) return { error: r.error };
  const { db, cap } = r;
  try {
    const picks = pickVaried(await candidates(db), PILOT_SIZE);
    if (!picks.length) return { error: "No named, unread files to try. Scan Dropbox first." };
    const res = await reserve(db, picks, "pilot", cap);
    let done = 0;
    await pool(res.reserved, PARALLEL, async (row) => {
      let pdf: string;
      try {
        pdf = await downloadPdf(row.dropbox);
      } catch (e) {
        await db.rpc("ai_release", { p_ids: [row.reading_id], p_error: msg(e) });
        return;
      }
      const out = await readNow(pdf, row.file_name ?? "", retryReserver(db, row, cap));
      await finish(db, row.reading_id, out.status, out.payload);
      done++;
    });
    await refreshIfAutoApproved(db, done);
    revalidatePath("/admin/import");
    const capNote = res.capped ? ` Stopped at the ${usd(cap)} cap.` : "";
    return { ok: true, summary: `Read ${done} of ${picks.length} pilot charts.${capNote}` };
  } catch (e) {
    revalidatePath("/admin/import");
    return { error: msg(e) };
  }
}

export async function approvePilot(prev: AiState): Promise<AiState> {
  void prev;
  const user = await getCurrentUser();
  if (user?.role !== "admin") return { error: "Admins only." };
  const db = await sessionClient();
  const { error } = await db.rpc("ai_approve_pilot");
  if (error) return { error: error.message };
  revalidatePath("/admin/import");
  return { ok: true, summary: "Pilot approved. The full batch can run." };
}

/**
 * One step of the full run, called over and over by the page while it's open:
 * collect any finished batches, then send the next chunk if the cap allows.
 * Safe to stop and restart at any point.
 */
export async function batchStep(prev: AiState): Promise<AiState> {
  void prev;
  const r = await ready();
  if ("error" in r) return { error: r.error };
  const { db, cap } = r;
  const started = Date.now();
  try {
    const collected = await collect(db, cap, started);
    await refreshIfAutoApproved(db, collected);
    const sent: Sent =
      Date.now() - started < TIME_BUDGET_MS / 2
        ? await sendChunk(db, cap, await openBatchCount(db))
        : { sent: 0, capped: false, left: 1, paused: false, full: true };
    const openBatches = await openBatchCount(db);
    revalidatePath("/admin/import");
    return {
      ok: true,
      more: sent.left > 0 && !sent.capped && !sent.paused && !sent.full,
      open: openBatches,
      capped: sent.capped,
      paused: sent.paused,
      summary:
        `Saved ${collected} results, sent ${sent.sent}. ${openBatches} batch${openBatches === 1 ? "" : "es"} processing.` +
        (sent.paused
          ? openBatches
            ? " The first chunk is being read; the run stops after it so you can check those charts."
            : " First chunk done: check those charts, then press Continue."
          : sent.full
            ? ` ${MAX_OPEN_BATCHES} batches out at once; the next goes when one finishes.`
            : "") +
        (sent.capped && openBatches
          ? ` Waiting for results: the ${usd(cap)} cap counts money held for running batches.`
          : sent.capped
            ? ` Stopped at the ${usd(cap)} cap: raise MAX_AI_SPEND_USD to send more.`
            : ""),
    };
  } catch (e) {
    revalidatePath("/admin/import");
    return { error: msg(e) };
  }
}

interface Sent {
  sent: number;
  capped: boolean;
  left: number;
  paused: boolean; // waiting for the first-chunk check
  full: boolean; // MAX_OPEN_BATCHES out already
}

async function openBatchCount(db: Db): Promise<number> {
  const { data, error } = await db.from("ai_readings").select("batch_id").eq("status", "submitted");
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((o) => o.batch_id)).size;
}

/** True while the first full-batch chunk hasn't been checked by an admin. */
async function firstChunkPending(db: Db): Promise<boolean> {
  const { data: st, error } = await db.from("ai_state").select("first_chunk_ok_at").single();
  if (error) throw new Error(error.message);
  if (st.first_chunk_ok_at) return false;
  const { count, error: e2 } = await db.from("ai_readings").select("id", { count: "exact", head: true }).eq("mode", "batch");
  if (e2) throw new Error(e2.message);
  return (count ?? 0) > 0;
}

async function sendChunk(db: Db, cap: number, open: number): Promise<Sent> {
  const all = await candidates(db);
  const none = { sent: 0, capped: false, paused: false, full: false };
  if (!all.length) return { ...none, left: 0 };
  if (await firstChunkPending(db)) return { ...none, left: all.length, paused: true };
  if (open >= MAX_OPEN_BATCHES) return { ...none, left: all.length, full: true };
  const res = await reserve(db, takeChunk(all, CHUNK, CHUNK_BYTES), "batch", cap);
  const items: { id: string; pdfB64: string; fileName: string }[] = [];
  await pool(res.reserved, 8, async (row) => {
    try {
      items.push({ id: row.reading_id, pdfB64: await downloadPdf(row.dropbox), fileName: row.file_name ?? "" });
    } catch (e) {
      await db.rpc("ai_release", { p_ids: [row.reading_id], p_error: msg(e) });
    }
  });
  const left = all.length - res.reserved.length;
  if (!items.length) return { ...none, capped: res.capped, left };
  const ids = items.map((x) => x.id);
  let batchId: string;
  try {
    batchId = await createBatch(items);
  } catch (e) {
    await db.rpc("ai_release", { p_ids: ids, p_error: `Batch not sent: ${msg(e)}` });
    throw e;
  }
  const { error } = await db.rpc("ai_mark_submitted", { p_ids: ids, p_batch_id: batchId });
  if (error) throw new Error(`Batch ${batchId} sent but not recorded: ${error.message}`);
  return { ...none, sent: ids.length, capped: res.capped, left };
}

/** The admin checked the first chunk's charts: let the rest of the full batch go. */
export async function confirmFirstChunk(prev: AiState): Promise<AiState> {
  void prev;
  const user = await getCurrentUser();
  if (user?.role !== "admin") return { error: "Admins only." };
  const db = await sessionClient();
  const { error } = await db.rpc("ai_confirm_first_chunk");
  if (error) return { error: error.message };
  revalidatePath("/admin/import");
  return { ok: true, summary: "First chunk checked. Press Continue full batch to send the rest." };
}

/**
 * "Retry failed": queue every file whose reading ended without a chart (needs manual,
 * refused, failed) for one more read. The full batch loop then sends them, under the cap.
 */
export async function retryFailed(prev: AiState): Promise<AiState> {
  void prev;
  const user = await getCurrentUser();
  if (user?.role !== "admin") return { error: "Admins only." };
  const db = await sessionClient();
  const { data, error } = await db.rpc("ai_retry_failed");
  if (error) return { error: error.message };
  revalidatePath("/admin/import");
  return { ok: true, summary: `${data} failed file${data === 1 ? "" : "s"} queued for one more read.` };
}

interface OpenRow {
  id: string;
  batch_id: string;
  import_files: { dropbox_file_id: string | null; dropbox_path: string; file_name: string | null; size_bytes: number | null } | null;
}

async function collect(db: Db, cap: number, started: number): Promise<number> {
  const { data, error } = await db
    .from("ai_readings")
    .select("id, batch_id, import_files(dropbox_file_id, dropbox_path, file_name, size_bytes)")
    .eq("status", "submitted");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as OpenRow[];
  const byBatch = new Map<string, Map<string, OpenRow>>();
  for (const row of rows) {
    if (!byBatch.has(row.batch_id)) byBatch.set(row.batch_id, new Map());
    byBatch.get(row.batch_id)!.set(row.id, row);
  }

  let saved = 0;
  for (const [batchId, open] of byBatch) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    if (!(await batchEnded(batchId))) continue;
    let finishedAll = true;
    for await (const res of await batchResults(batchId)) {
      const row = open.get(res.custom_id);
      if (!row) continue; // saved on an earlier collect
      if (Date.now() - started > TIME_BUDGET_MS) {
        finishedAll = false;
        break;
      }
      const f = row.import_files;
      const reserved: Reserved = {
        reading_id: row.id,
        dropbox: f?.dropbox_file_id ?? f?.dropbox_path ?? "",
        file_name: f?.file_name ?? "",
        size: f?.size_bytes ?? null,
      };
      if (res.result.type === "succeeded") {
        const out = await finishReading(
          res.result.message,
          true,
          async () => requestParams(await downloadPdf(reserved.dropbox), reserved.file_name ?? ""),
          retryReserver(db, reserved, cap),
        );
        await finish(db, row.id, out.status, out.payload);
      } else {
        // errored / canceled / expired: not billed, so the file can be read again later.
        const why = res.result.type === "errored" ? `Batch error: ${res.result.error.error.type}` : `Batch ${res.result.type}`;
        await finish(db, row.id, "error", finishPayload({ kind: "error", error: why }, 0, noTokens()));
      }
      open.delete(res.custom_id);
      saved++;
    }
    if (finishedAll) {
      // Anything the batch didn't return at all.
      for (const id of open.keys()) {
        await finish(db, id, "error", finishPayload({ kind: "error", error: "Missing from batch results" }, 0, noTokens()));
      }
    }
  }
  return saved;
}
