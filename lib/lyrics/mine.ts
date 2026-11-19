"use client";

// A player's own lyrics choices (Q18): per song, Lyrics on/off and where they moved lines in
// "Adjust lyrics"; per player, the desktop "Side panel" switch. Never lyric text: line numbers
// and bar-row references (integers, lib/lyrics/place.ts) only.
// Signed out: this device only. Signed in: the account (lyrics_mine / lyrics_save_mine,
// user_prefs.lyrics_panel) plus a device copy for offline; the newest change wins.
import { useMemo } from "react";
import { browserClient } from "@/lib/supabase/browser";
import { isOffline } from "@/lib/offline/status";
import { PREF, readPref, setPref, usePref } from "@/lib/prefs";

export interface Mine {
  shown: boolean;
  placements: number[]; // flat [line, label hash, nth, bar row] x n (encodePlacements)
  lrclib: number | null; // the lyrics record the placements were made against
  at: string | null; // when this player last changed it (null = never)
  songId?: string | null; // known once the account answered
}
const EMPTY: Mine = { shown: false, placements: [], lrclib: null, at: null };

const key = (uid: string | null, slug: string) => PREF.lyricsSong(uid ?? "out", slug);

function parse(raw: string | null): Mine {
  try {
    const v = JSON.parse(raw ?? "null");
    if (!v || typeof v !== "object") return EMPTY;
    return {
      shown: v.shown === true,
      placements: Array.isArray(v.placements) ? v.placements.filter(Number.isInteger) : [],
      lrclib: Number.isInteger(v.lrclib) ? v.lrclib : null,
      at: typeof v.at === "string" ? v.at : null,
      songId: typeof v.songId === "string" ? v.songId : null,
    };
  } catch {
    return EMPTY;
  }
}
const readMine = (uid: string | null, slug: string) => parse(readPref(key(uid, slug)));
const writeMine = (uid: string | null, slug: string, m: Mine) => setPref(key(uid, slug), JSON.stringify(m));

/** This player's record for one song on this device (live). */
export function useMine(uid: string | null, slug: string): Mine {
  const raw = usePref(key(uid, slug));
  return useMemo(() => parse(raw), [raw]);
}

async function push(songId: string, m: Mine) {
  const { error } = await browserClient().rpc("lyrics_save_mine", {
    p_song: songId,
    p_shown: m.shown,
    p_placements: m.placements,
    p_lrclib_id: m.lrclib,
    p_at: m.at ?? new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

/** Change this player's record for a song: on this device at once, the account when signed in
 *  and online (a change made offline goes up on the next sync, being the newest). */
export async function saveMine(uid: string | null, slug: string, patch: Partial<Omit<Mine, "at" | "songId">>): Promise<void> {
  const next = { ...readMine(uid, slug), ...patch, at: new Date().toISOString() };
  writeMine(uid, slug, next);
  if (uid && next.songId && !isOffline()) await push(next.songId, next);
}

type MineRow = { song_id: string; shown: boolean | null; placements: number[] | null; lrclib_id: number | null; changed_at: string | null };
const syncing = new Map<string, Promise<void>>();

/** Signed in: line up this device and the account for one song, newest change wins. Once per
 *  song per page load; never throws. */
export function syncMine(uid: string, slug: string): Promise<void> {
  const k = key(uid, slug);
  let p = syncing.get(k);
  if (!p) {
    p = (async () => {
      const { data, error } = await browserClient().rpc("lyrics_mine", { p_slug: slug });
      if (error) throw error;
      const row = (data as MineRow[] | null)?.[0];
      if (!row) return;
      const dev = readMine(uid, slug);
      const acc: Mine | null = row.changed_at
        ? { shown: row.shown === true, placements: row.placements ?? [], lrclib: row.lrclib_id ?? null, at: row.changed_at }
        : null;
      if (acc && (!dev.at || Date.parse(acc.at!) >= Date.parse(dev.at))) writeMine(uid, slug, { ...acc, songId: row.song_id });
      else {
        writeMine(uid, slug, { ...dev, songId: row.song_id });
        if (dev.at) await push(row.song_id, dev);
      }
    })().catch(() => {
      syncing.delete(k); // try again next time
    });
    syncing.set(k, p);
  }
  return p;
}

/** Desktop "Side panel" switch (per player). */
export function usePanel(): boolean {
  return usePref(PREF.lyricsPanel) === "1";
}
export function setPanel(uid: string | null, on: boolean) {
  setPref(PREF.lyricsPanel, on ? "1" : "0");
  if (uid && !isOffline()) {
    void browserClient()
      .from("user_prefs")
      .upsert({ user_id: uid, lyrics_panel: on, updated_at: new Date().toISOString() })
      .then(() => {}, () => {});
  }
}
let panelSynced: string | null = null;
/** Signed in: take the account's side panel choice (once per page load). */
export async function syncPanel(uid: string) {
  if (panelSynced === uid || isOffline()) return;
  panelSynced = uid;
  try {
    const { data } = await browserClient().from("user_prefs").select("lyrics_panel").eq("user_id", uid).maybeSingle();
    if (typeof data?.lyrics_panel === "boolean") setPref(PREF.lyricsPanel, data.lyrics_panel ? "1" : "0");
  } catch {
    panelSynced = null;
  }
}
