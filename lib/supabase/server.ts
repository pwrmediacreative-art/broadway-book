import { createClient } from "@supabase/supabase-js";
import { cacheLife, cacheTag } from "next/cache";
import type { IndexRow } from "@/lib/search/pack";

/** Cache tag for every public song read; server actions call updateTag(SONGS_TAG) after a publish. */
export const SONGS_TAG = "songs";

/** Read-only public client (anon key). RLS limits it to published songs. */
export function publicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

/** The API returns at most 1,000 rows per request: read every published song in pages. */
export const PAGE_ROWS = 1000;
export async function allPages<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await page(from, from + PAGE_ROWS - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE_ROWS) return out;
  }
}

export interface SongListItem {
  slug: string;
  title: string;
  artist: string | null;
  key: string | null;
  is_example: boolean;
  unverified: boolean;
}

export async function listSongs(): Promise<SongListItem[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag(SONGS_TAG);
  const db = publicClient();
  return allPages<SongListItem>((from, to) =>
    db.from("songs").select("slug, title, artist, key, is_example, unverified").eq("status", "published").order("title").order("slug").range(from, to),
  );
}

export async function getSong(slug: string) {
  "use cache";
  cacheLife("minutes");
  cacheTag(SONGS_TAG);
  const { data, error } = await publicClient()
    .from("songs")
    .select("id, slug, title, artist, key, is_example, unverified, verified_at, current_revision_id, current:revisions!songs_current_revision_fk(chart_text)")
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
  cacheTag(SONGS_TAG);
  const db = publicClient();
  return allPages<IndexRow>((from, to) =>
    db
      .from("songs")
      .select("slug, title, artist, key, bpm, time_sig, feel, tags, is_example, unverified")
      .eq("status", "published")
      .order("title")
      .order("slug")
      .range(from, to),
  );
}

/** The current slug of a published song that used to live at `slug` (it was renamed), or null. */
export async function renamedSlug(slug: string): Promise<string | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag(SONGS_TAG);
  const { data, error } = await publicClient().rpc("resolve_slug", { p_slug: slug });
  if (error) throw error;
  return (data as string | null) ?? null;
}
