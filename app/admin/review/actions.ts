"use server";

// Review queue actions. They run as the signed-in user; the database functions refuse
// anyone who isn't an admin. Chart text is checked with the parser before saving.
import { revalidatePath, updateTag } from "next/cache";
import { checkChart, MAX_CUE_WORDS } from "@/lib/chart";
import { sessionClient } from "@/lib/supabase/session";
import { SONGS_TAG } from "@/lib/supabase/server";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const fail = (e: { message: string }): { ok: false; error: string } =>
  /permission denied|admins only/i.test(e.message) ? { ok: false, error: "Admins only." } : { ok: false, error: e.message };

export async function publishReview(songId: string, chartText: string, verified: boolean, baseRevisionId: string | null): Promise<Result> {
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
