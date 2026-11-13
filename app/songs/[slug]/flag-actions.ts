"use server";

import { sessionClient } from "@/lib/supabase/session";
import { FLAG_REASONS, type FlagReason } from "@/lib/review/unclear";

export type FlagResult = { ok: true; already: boolean } | { ok: false; error: string };

/** A signed-in player flags a chart as wrong. The database enforces one open flag each. */
export async function flagChart(songId: string, reason: FlagReason, details: string): Promise<FlagResult> {
  if (!(reason in FLAG_REASONS)) return { ok: false, error: "Pick a reason." };
  const note = details.trim();
  if (note.length > 300) return { ok: false, error: "Keep the note under 300 characters." };
  const db = await sessionClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to flag a chart." };
  const { data, error } = await db.rpc("flag_chart", { p_song_id: songId, p_reason: reason, p_details: note });
  if (error) return { ok: false, error: error.message };
  return { ok: true, already: data === "already" };
}
