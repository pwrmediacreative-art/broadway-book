"use server";

// Admin lyrics controls. The database functions check the admin role and log every change.
import { sessionClient } from "@/lib/supabase/session";

type Result = { ok: true } | { ok: false; error: string };
const done = (error: { message: string } | null): Result => (error ? { ok: false, error: error.message } : { ok: true });

export async function setLyricsAudience(value: 0 | 1 | 2 | 3): Promise<Result> {
  return done((await (await sessionClient()).rpc("lyrics_set_audience", { p_value: value })).error);
}
export async function setLyricsHidden(songId: string, hidden: boolean): Promise<Result> {
  return done((await (await sessionClient()).rpc("lyrics_set_hidden", { p_song: songId, p_hidden: hidden })).error);
}
export async function setLyricsPick(songId: string, lrclibId: number | null): Promise<Result> {
  return done((await (await sessionClient()).rpc("lyrics_set_pick", { p_song: songId, p_lrclib_id: lrclibId })).error);
}
