"use client";

// Reading the phone's saved copy: charts, the alphabetical neighbours of a song, and saved
// setlists. Every function answers "nothing saved" (null) instead of throwing.
import { readPref } from "@/lib/prefs";
import { unpackIndex } from "@/lib/search/pack";
import type { AccountSet, SetlistSummary } from "@/lib/setlists/api";
import type { SetSong } from "@/lib/setlists/play";
import { dbAll, dbGet, dbKeys, KV, kvDel, kvGet, kvSet, SONGS } from "./db";
import type { SavedSong } from "./plan";

/** Written after each full sync. `since` is what the next sync asks the server for. */
export interface SyncMeta {
  since: string;
  at: number; // when the last successful sync finished (this phone's clock)
  count: number; // charts saved
  bytes: number; // size of the saved charts
}
export const META = "sync";

export async function syncMeta(): Promise<SyncMeta | null> {
  try {
    return (await kvGet<SyncMeta>(META)) ?? null;
  } catch {
    return null;
  }
}

export async function savedSong(slug: string): Promise<SavedSong | null> {
  try {
    return (await dbGet<SavedSong>(SONGS, slug)) ?? null;
  } catch {
    return null;
  }
}

const asSetSong = (s: SavedSong): SetSong => ({ slug: s.slug, title: s.title, artist: s.artist, key: s.key, chart_text: s.chart_text });

/** Saved charts by slug, or null when this phone has never finished saving charts. */
export async function savedSongs(slugs: string[]): Promise<Map<string, SetSong> | null> {
  if (!(await syncMeta())) return null;
  const out = new Map<string, SetSong>();
  for (const slug of new Set(slugs)) {
    const s = await savedSong(slug);
    if (s) out.set(slug, asSetSong(s));
  }
  return out;
}

export interface SongLink {
  slug: string;
  title: string;
}

/** Previous/next song in the home list's order (the saved search index; A–Z as a fallback). */
export async function savedNeighbors(slug: string): Promise<{ prev: SongLink | null; next: SongLink | null }> {
  let list: SongLink[] = [];
  try {
    const raw = readPref("bb.index");
    list = (raw ? unpackIndex(JSON.parse(raw)) : null) ?? [];
  } catch {
    // no saved index
  }
  if (!list.some((s) => s.slug === slug)) {
    try {
      list = (await dbAll<SavedSong>(SONGS)).sort((a, b) => a.title.localeCompare(b.title));
    } catch {
      list = [];
    }
  }
  const i = list.findIndex((s) => s.slug === slug);
  const link = (s: SongLink | undefined) => (s ? { slug: s.slug, title: s.title } : null);
  return i < 0 ? { prev: null, next: null } : { prev: link(list[i - 1]), next: link(list[i + 1]) };
}

// --- setlists -----------------------------------------------------------------------------

export const setKey = (by: { uid: string; id: string } | { code: string }) =>
  "code" in by ? `set:c:${by.code}` : `set:u:${by.uid}:${by.id}`;

export async function saveSet(key: string, set: AccountSet): Promise<void> {
  try {
    await kvSet(key, set);
  } catch {
    // storage refused: the setlist just isn't available offline
  }
}

export async function dropSets(keys: string[]): Promise<void> {
  try {
    await kvDel(keys);
  } catch {
    // ignore
  }
}

export async function savedSetKeys(prefix: string): Promise<string[]> {
  try {
    return (await dbKeys(KV)).filter((k) => k.startsWith(prefix));
  } catch {
    return [];
  }
}

export async function rawSavedSet(key: string): Promise<AccountSet | null> {
  try {
    return (await kvGet<AccountSet>(key)) ?? null;
  } catch {
    return null;
  }
}

/**
 * A saved setlist with its charts taken from the phone's chart copy, so they are as fresh as
 * the last sync and songs that are no longer published show as "Not available".
 */
export async function savedSet(key: string): Promise<AccountSet | null> {
  const set = await rawSavedSet(key);
  if (!set) return null;
  const synced = !!(await syncMeta());
  const items = await Promise.all(
    set.items.map(async (it) => {
      if (!it.song) return it;
      const s = await savedSong(it.song.slug);
      if (s) return { ...it, slug: s.slug, song: asSetSong(s) };
      return synced ? { ...it, slug: null, song: null } : it;
    }),
  );
  return { ...set, items, saved: true };
}

export async function saveSummaries(uid: string, lists: SetlistSummary[]): Promise<void> {
  try {
    await kvSet(`sets:${uid}`, lists);
  } catch {
    // ignore
  }
}

export async function savedSummaries(uid: string): Promise<SetlistSummary[] | null> {
  try {
    return (await kvGet<SetlistSummary[]>(`sets:${uid}`)) ?? null;
  } catch {
    return null;
  }
}
