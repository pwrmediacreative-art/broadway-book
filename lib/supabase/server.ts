import { createClient } from "@supabase/supabase-js";
import { cacheLife } from "next/cache";
import type { IndexRow } from "@/lib/search/pack";

/** Read-only public client (anon key). RLS limits it to published songs. */
export function publicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

export interface SongListItem {
  slug: string;
  title: string;
  artist: string | null;
  key: string | null;
  is_example: boolean;
}

export async function listSongs(): Promise<SongListItem[]> {
  "use cache";
  cacheLife("minutes");
  const { data, error } = await publicClient()
    .from("songs")
    .select("slug, title, artist, key, is_example")
    .eq("status", "published")
    .order("title");
  if (error) throw error;
  return data ?? [];
}

export async function getSong(slug: string) {
  "use cache";
  cacheLife("minutes");
  const { data, error } = await publicClient()
    .from("songs")
    .select("slug, title, artist, key, is_example, current:revisions!songs_current_revision_fk(chart_text)")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const current = data.current as unknown as { chart_text: string } | null;
  return { ...data, chart_text: current?.chart_text ?? null };
}

/** Every published song with the fields the search index needs (see lib/search/pack.ts). */
export async function listSongIndex(): Promise<IndexRow[]> {
  "use cache";
  cacheLife("minutes");
  const { data, error } = await publicClient()
    .from("songs")
    .select("slug, title, artist, key, bpm, time_sig, feel, tags, is_example")
    .eq("status", "published")
    .order("title");
  if (error) throw error;
  return data ?? [];
}
