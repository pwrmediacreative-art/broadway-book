"use server";

// Renaming songs. These run as the signed-in user (session client); the database functions
// (20261118100000_song_rename.sql) decide who may rename, suggest or vote.
import { revalidatePath, updateTag } from "next/cache";
import { sessionClient } from "@/lib/supabase/session";
import { SONGS_TAG } from "@/lib/supabase/server";

export type RenameResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const plain = (e: { message: string }) =>
  /permission denied|row-level security/i.test(e.message) ? "You can't do that." : e.message;

function refresh() {
  updateTag(SONGS_TAG); // song pages, search index, browse
  revalidatePath("/community");
  revalidatePath("/admin/review");
  revalidatePath("/admin/import");
}

/** Admins (any song) and uploaders (their own uploaded chart): rename now. Returns the new slug. */
export async function renameSong(input: { songId: string; title: string; artist: string }): Promise<RenameResult<{ slug: string }>> {
  const db = await sessionClient();
  const { data, error } = await db.rpc("rename_song", { p_song: input.songId, p_title: input.title, p_artist: input.artist });
  if (error) return { ok: false, error: plain(error) };
  refresh();
  revalidatePath(`/upload/${input.songId}`);
  return { ok: true, slug: data as string };
}

