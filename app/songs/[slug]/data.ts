import { notFound, permanentRedirect } from "next/navigation";
import { getSong, listSongs, renamedSlug, type SongListItem } from "@/lib/supabase/server";
import type { Neighbors } from "./hooks";

const link = (s: SongListItem | undefined) => (s ? { slug: s.slug, title: s.title } : null);

/** A song plus its alphabetical neighbours (used when the player didn't come from a list). */
export async function songPageData(slug: string) {
  const [song, list] = await Promise.all([getSong(slug), listSongs()]);
  const i = list.findIndex((s) => s.slug === slug);
  const neighbors: Neighbors = i < 0 ? { prev: null, next: null } : { prev: link(list[i - 1]), next: link(list[i + 1]) };
  return { song, neighbors };
}

/** Song + stage pages built ahead of time. The rest render on their first visit and are
 *  then cached: building all ~2,400 of each ran Vercel's one build worker out of memory.
 *  Cache Components needs at least one, so a small fixed sample is built. */
export const BUILD_AHEAD = 20;
export async function buildParams() {
  const songs = await listSongs();
  return songs.slice(0, BUILD_AHEAD).map((s) => ({ slug: s.slug }));
}

/** No song at this address: send renamed songs' old links to the new address, else 404. */
export async function movedOrNotFound(slug: string, rest = ""): Promise<never> {
  const to = await renamedSlug(slug);
  if (to) permanentRedirect(`/songs/${to}${rest}`);
  notFound();
}
