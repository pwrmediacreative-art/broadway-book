import { getSong, listSongs, type SongListItem } from "@/lib/supabase/server";
import type { Neighbors } from "./hooks";

const link = (s: SongListItem | undefined) => (s ? { slug: s.slug, title: s.title } : null);

/** A song plus its alphabetical neighbours (used when the player didn't come from a list). */
export async function songPageData(slug: string) {
  const [song, list] = await Promise.all([getSong(slug), listSongs()]);
  const i = list.findIndex((s) => s.slug === slug);
  const neighbors: Neighbors = i < 0 ? { prev: null, next: null } : { prev: link(list[i - 1]), next: link(list[i + 1]) };
  return { song, neighbors };
}
