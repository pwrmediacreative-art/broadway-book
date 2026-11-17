// Before a rename: does another song already have this title + artist? (case-insensitive,
// trimmed). Runs in the browser as the signed-in user, so RLS decides which songs it can see.
import { browserClient } from "@/lib/supabase/browser";

const norm = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
// ilike treats % and _ as wildcards; escape them so the title matches as written.
const literal = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function findSameName(
  songId: string,
  title: string,
  artist: string,
): Promise<{ slug: string; title: string; artist: string | null } | null> {
  const t = title.trim().replace(/\s+/g, " ");
  if (!t) return null;
  const { data, error } = await browserClient()
    .from("songs")
    .select("id, slug, title, artist")
    .ilike("title", literal(t))
    .neq("id", songId)
    .limit(50);
  if (error || !data) return null; // the check is a courtesy; the rename itself still runs
  const a = norm(artist);
  const hit = (data as { id: string; slug: string; title: string; artist: string | null }[]).find(
    (s) => norm(s.title) === norm(t) && norm(s.artist) === a,
  );
  return hit ? { slug: hit.slug, title: hit.title, artist: hit.artist } : null;
}
