"use server";

// Review actions. They run as the signed-in user; the database functions refuse anyone
// who isn't an admin or trusted reviewer (and keep Hold, bulk publish, dismissing flags
// and duplicates admin-only). Every change needs the song's claim. Chart text is checked
// with the parser before saving.
import { revalidatePath, updateTag } from "next/cache";
import { checkChart, MAX_CUE_WORDS } from "@/lib/chart";
import { sessionClient } from "@/lib/supabase/session";
import { SONGS_TAG } from "@/lib/supabase/server";
import { cleanSkip, isUuid, type Filter, type Order } from "@/lib/review/queue";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const fail = (e: { message: string }): { ok: false; error: string } =>
  /permission denied|admins only/i.test(e.message)
    ? { ok: false, error: "Admins only." }
    : /reviewers only/i.test(e.message)
      ? { ok: false, error: "Reviewers only." }
      : { ok: false, error: e.message };

const bad = { ok: false as const, error: "Bad request." };

export async function publishReview(songId: string, chartText: string, verified: boolean, baseRevisionId: string | null): Promise<Result> {
  if (!isUuid(songId) || (baseRevisionId !== null && !isUuid(baseRevisionId))) return bad;
  const c = checkChart(chartText);
  if (c.error) return { ok: false, error: `Chart format error: ${c.error}` };
  if (c.longCues.length) return { ok: false, error: `Cues must be ${MAX_CUE_WORDS} words or fewer (no lyrics): "${c.longCues[0]}"` };
  const db = await sessionClient();
  const { error } = await db.rpc("review_publish", {
    p_song_id: songId,
    p_chart: c.canonical,
    p_verified: verified,
    p_base_revision: baseRevisionId,
  });
  if (error) return fail(error);
  updateTag(SONGS_TAG);
  revalidatePath("/admin/review");
  return { ok: true };
}

export async function setHold(songId: string, hold: boolean): Promise<Result> {
  const db = await sessionClient();
  const { error } = await db.rpc("review_set_hold", { p_song_id: songId, p_hold: hold });
  if (error) return fail(error);
  revalidatePath("/admin/review");
  return { ok: true };
}

export async function dismissFlags(songId: string): Promise<Result<{ n: number }>> {
  const db = await sessionClient();
  const { data, error } = await db.rpc("review_dismiss_flags", { p_song_id: songId });
  if (error) return fail(error);
  revalidatePath("/admin/review");
  return { ok: true, n: Number(data ?? 0) };
}

/** Count (dryRun) or publish as unverified every clean-enough song in the queue. */
export async function bulkUnverified(maxUnclear: number, minConfidence: number, dryRun: boolean): Promise<Result<{ n: number }>> {
  if (!Number.isInteger(maxUnclear) || maxUnclear < 0 || maxUnclear > 50) return { ok: false, error: "Unclear spots: 0 to 50." };
  if (!(minConfidence >= 0 && minConfidence <= 1)) return { ok: false, error: "Confidence: 0 to 1." };
  const db = await sessionClient();
  const { data, error } = await db.rpc("review_bulk_unverified", {
    p_max_unclear: maxUnclear,
    p_min_conf: minConfidence,
    p_dry_run: dryRun,
  });
  if (error) return fail(error);
  if (!dryRun) {
    updateTag(SONGS_TAG);
    revalidatePath("/admin/review");
  }
  return { ok: true, n: Number(data ?? 0) };
}

export interface Claim {
  mine: boolean;
  by: string | null;
  expires_at: string | null;
}

/** Claim (or renew) a song for 30 minutes from now. */
export async function claimReview(songId: string): Promise<Result<{ claim: Claim }>> {
  if (!isUuid(songId)) return bad;
  const db = await sessionClient();
  const { data, error } = await db.rpc("review_claim", { p_song_id: songId });
  if (error) return fail(error);
  return { ok: true, claim: data as Claim };
}

export async function releaseReview(songId: string): Promise<Result> {
  if (!isUuid(songId)) return bad;
  const db = await sessionClient();
  const { error } = await db.rpc("review_release", { p_song_id: songId });
  if (error) return fail(error);
  return { ok: true };
}

/** One working draft per song. The chart must parse (and has no long cues), same as publishing. */
export async function saveDraft(songId: string, chartText: string, baseRevisionId: string | null): Promise<Result<{ at: string }>> {
  if (!isUuid(songId) || (baseRevisionId !== null && !isUuid(baseRevisionId))) return bad;
  const c = checkChart(chartText);
  if (c.error) return { ok: false, error: `Chart format error: ${c.error}` };
  if (c.longCues.length) return { ok: false, error: `Cues must be ${MAX_CUE_WORDS} words or fewer (no lyrics): "${c.longCues[0]}"` };
  const db = await sessionClient();
  const { data, error } = await db.rpc("review_save_draft", { p_song_id: songId, p_chart: c.canonical, p_base_revision: baseRevisionId });
  if (error) return fail(error);
  return { ok: true, at: String(data) };
}

export async function discardDraft(songId: string): Promise<Result> {
  if (!isUuid(songId)) return bad;
  const db = await sessionClient();
  const { error } = await db.rpc("review_discard_draft", { p_song_id: songId });
  if (error) return fail(error);
  return { ok: true };
}

export async function cantRead(songId: string): Promise<Result> {
  if (!isUuid(songId)) return bad;
  const db = await sessionClient();
  const { error } = await db.rpc("review_cant_read", { p_song_id: songId });
  if (error) return fail(error);
  revalidatePath("/admin/review");
  return { ok: true };
}

/** Admins: hide this copy for good (another song has the same title and artist). */
export async function markDuplicate(songId: string): Promise<Result> {
  if (!isUuid(songId)) return bad;
  const db = await sessionClient();
  const { error } = await db.rpc("review_mark_duplicate", { p_song_id: songId });
  if (error) return fail(error);
  updateTag(SONGS_TAG);
  revalidatePath("/admin/review");
  return { ok: true };
}

/** The next song in the chosen order that nobody else holds, skipping p_skip. */
export async function nextReview(filter: Filter, order: Order, skip: string[]): Promise<Result<{ id: string | null }>> {
  const db = await sessionClient();
  const { data, error } = await db.rpc("review_next", { p_filter: filter, p_order: order, p_skip: cleanSkip(skip) });
  if (error) return fail(error);
  return { ok: true, id: (data as string | null) ?? null };
}

/** A needs_manual PDF with no song yet: make its song (needs a title and artist). */
export async function songForFile(fileId: string): Promise<Result<{ id: string }>> {
  if (!isUuid(fileId)) return bad;
  const db = await sessionClient();
  const { data, error } = await db.rpc("review_file_song", { p_file_id: fileId });
  if (error) return fail(error);
  if (!data) return { ok: false, error: "Set this file's title and artist on the Import page first." };
  return { ok: true, id: String(data) };
}
