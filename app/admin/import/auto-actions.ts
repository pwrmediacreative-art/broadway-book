"use server";

// Auto-approve controls on /admin/import. They run as the signed-in user; the database
// functions refuse anyone who isn't an admin and hold the whole rule
// (20261114100000_auto_approve.sql). Nothing here decides which charts qualify.
import { revalidatePath, updateTag } from "next/cache";
import { sessionClient } from "@/lib/supabase/session";
import { SONGS_TAG } from "@/lib/supabase/server";

export type AutoResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const fail = (e: { message: string }): { ok: false; error: string } =>
  /permission denied|admins only/i.test(e.message) ? { ok: false, error: "Admins only." } : { ok: false, error: e.message };

const refresh = () => {
  revalidatePath("/admin/import");
  revalidatePath("/admin/review");
};

/** The switch, the cutoff (whole percent, 50 to 99; a score must be strictly over it) and
 *  the most unclear spots a chart may have (0 to 10). */
export async function saveAutoSettings(enabled: boolean, minConfidence: number, maxUnclear: number): Promise<AutoResult> {
  if (!Number.isInteger(minConfidence) || minConfidence < 50 || minConfidence > 99) return { ok: false, error: "Cutoff: a whole percent from 50 to 99." };
  if (!Number.isInteger(maxUnclear) || maxUnclear < 0 || maxUnclear > 10) return { ok: false, error: "Unclear spots: 0 to 10." };
  const db = await sessionClient();
  const { error } = await db.rpc("auto_approve_set", { p_enabled: enabled, p_min_confidence: minConfidence, p_max_unclear: maxUnclear });
  if (error) return fail(error);
  refresh();
  return { ok: true };
}

/** Count (dryRun) or publish, as Unverified, every draft that passes the rule with the saved settings. */
export async function autoApproveExisting(dryRun: boolean): Promise<AutoResult<{ n: number }>> {
  const db = await sessionClient();
  const { data, error } = await db.rpc("auto_approve_existing", { p_dry_run: dryRun });
  if (error) return fail(error);
  if (!dryRun) {
    updateTag(SONGS_TAG); // home list, search index and offline sync read through this tag
    refresh();
  }
  return { ok: true, n: Number(data ?? 0) };
}

/** Count (dryRun) or send back to needs_review every auto-approved chart nobody has verified. */
export async function pullBackAuto(dryRun: boolean): Promise<AutoResult<{ n: number }>> {
  const db = await sessionClient();
  const { data, error } = await db.rpc("auto_approve_pull_back", { p_dry_run: dryRun });
  if (error) return fail(error);
  if (!dryRun) {
    updateTag(SONGS_TAG);
    refresh();
  }
  return { ok: true, n: Number(data ?? 0) };
}
