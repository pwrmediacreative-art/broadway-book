"use client";

// Account setlists through the browser client. RLS + the setlist_* database functions do
// the permission checks; this file only shapes the data. Each setlist and every chart in it
// load in ONE request (setlist_bundle / songs_bundle), so the offline step can cache them.
import { browserClient } from "@/lib/supabase/browser";
import type { PlaySet, SetItem, SetSong } from "./play";

export interface SetlistSummary {
  id: string;
  name: string;
  gig_date: string | null;
  updated_at: string;
  shared: boolean;
  count: number;
}

export interface AccountSet extends PlaySet {
  id: string | null; // null when opened by share code
  share_code: string | null;
  mine: boolean;
  updated_at: string;
}

const db = () => browserClient();
const fail = (e: { message: string } | null) => {
  if (e) throw new Error(e.message);
};

export async function currentUserId(): Promise<string | null> {
  const {
    data: { session },
  } = await db().auth.getSession();
  return session?.user.id ?? null;
}

export async function listMySetlists(): Promise<SetlistSummary[]> {
  const { data, error } = await db()
    .from("setlists")
    .select("id, name, gig_date, updated_at, share_code, setlist_items(count)")
    .order("updated_at", { ascending: false });
  fail(error);
  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    gig_date: r.gig_date,
    updated_at: r.updated_at,
    shared: !!r.share_code,
    count: (r.setlist_items as unknown as { count: number }[])[0]?.count ?? 0,
  }));
}

interface BundleRow {
  id: string | null;
  name: string;
  gig_date: string | null;
  updated_at: string;
  share_code: string | null;
  mine: boolean;
  items: { song_id: string; key_override: string | null; note: string | null; song: SetSong | null }[];
}

const toSet = (b: BundleRow): AccountSet => ({
  id: b.id,
  name: b.name,
  gig_date: b.gig_date,
  updated_at: b.updated_at,
  share_code: b.share_code,
  mine: b.mine,
  items: b.items.map((i): SetItem => ({ song_id: i.song_id, slug: i.song?.slug ?? null, key: i.key_override, note: i.note, song: i.song })),
});

/** Your setlist by id, or null if it doesn't exist / isn't yours. */
export async function loadSetlist(id: string): Promise<AccountSet | null> {
  const { data, error } = await db().rpc("setlist_bundle", { p_id: id });
  fail(error);
  return data ? toSet(data as BundleRow) : null;
}

/** A shared setlist by its secret code (works signed out), or null if the link was turned off. */
export async function loadSharedSetlist(code: string): Promise<AccountSet | null> {
  const { data, error } = await db().rpc("setlist_bundle", { p_code: code });
  fail(error);
  return data ? toSet(data as BundleRow) : null;
}

/** Published songs with charts, by slug (device setlists and snapshot links). */
export async function loadSongs(slugs: string[]): Promise<Map<string, SetSong>> {
  if (!slugs.length) return new Map();
  const { data, error } = await db().rpc("songs_bundle", { p_slugs: [...new Set(slugs)] });
  fail(error);
  return new Map(((data ?? []) as SetSong[]).map((s) => [s.slug, s]));
}

export async function createSetlist(name: string): Promise<string> {
  const { data, error } = await db().from("setlists").insert({ name: name.trim().slice(0, 100) || "New setlist" }).select("id").single();
  fail(error);
  return data!.id as string;
}

export async function saveSetlist(id: string, s: { name: string; gig_date: string | null; items: SetItem[] }): Promise<void> {
  const { error } = await db().rpc("setlist_save", {
    p_id: id,
    p_name: s.name.trim().slice(0, 100) || "Untitled setlist",
    p_date: s.gig_date || null,
    p_items: s.items.map((i) => (i.song_id ? { song_id: i.song_id, key: i.key, note: i.note } : { slug: i.slug, key: i.key, note: i.note })),
  });
  fail(error);
}

export async function addToSetlist(id: string, slug: string): Promise<void> {
  const { error } = await db().rpc("setlist_add", { p_id: id, p_slug: slug });
  fail(error);
}

/** Turn sharing on (returns the new code) or off (returns null). */
export async function shareSetlist(id: string, on: boolean): Promise<string | null> {
  const { data, error } = await db().rpc("setlist_share", { p_id: id, p_on: on });
  fail(error);
  return (data as string | null) ?? null;
}

export async function deleteSetlist(id: string): Promise<void> {
  const { error } = await db().from("setlists").delete().eq("id", id);
  fail(error);
}
