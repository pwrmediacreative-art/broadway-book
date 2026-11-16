import { sessionClient } from "@/lib/supabase/session";
import type { MineChart } from "@/lib/upload/mine";

/** An uploaded chart the signed-in user may open (RLS: the owner, or any admin for an admin's upload), or null. */
export async function loadMine(id: string): Promise<MineChart | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const db = await sessionClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  const { data } = await db
    .from("songs")
    .select("id, slug, title, artist, key, owner_id, owner:profiles!songs_owner_id_fkey(display_name), current:revisions!songs_current_revision_fk(chart_text)")
    .eq("id", id)
    .eq("status", "private")
    .maybeSingle();
  const text = (data?.current as unknown as { chart_text: string } | null)?.chart_text;
  if (!data || !text) return null;
  const mine = !!user && data.owner_id === user.id;
  const by = mine ? null : ((data.owner as unknown as { display_name: string | null } | null)?.display_name ?? "another admin");
  return { id: data.id, slug: data.slug, title: data.title, artist: data.artist, key: data.key, chart_text: text, mine, by };
}
