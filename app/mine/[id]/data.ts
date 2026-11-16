import { sessionClient } from "@/lib/supabase/session";
import type { MineChart } from "@/lib/upload/mine";

/** One of the signed-in user's private charts (RLS: owner only), or null. */
export async function loadMine(id: string): Promise<MineChart | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const db = await sessionClient();
  const { data } = await db
    .from("songs")
    .select("id, slug, title, artist, key, current:revisions!songs_current_revision_fk(chart_text)")
    .eq("id", id)
    .eq("status", "private")
    .maybeSingle();
  const text = (data?.current as unknown as { chart_text: string } | null)?.chart_text;
  if (!data || !text) return null;
  return { id: data.id, slug: data.slug, title: data.title, artist: data.artist, key: data.key, chart_text: text };
}
