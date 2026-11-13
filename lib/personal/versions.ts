"use client";

// The signed-in player's personal chart versions ("Just for me"). All of them load in ONE
// request (RLS: owner only) and are kept on this device under the owner's id, so the
// offline step can reuse them. Never part of the search index or any cached public page.
import { useSyncExternalStore } from "react";
import { browserClient } from "@/lib/supabase/browser";
import { PREF, setPref, usePref } from "@/lib/prefs";

export interface PersonalVersion {
  song_id: string;
  slug: string;
  title: string;
  artist: string | null;
  chart_text: string;
  note: string | null;
  based_on_revision_id: string | null;
  current_revision_id: string | null; // the song's live revision right now
  updated_at: string;
}

interface State {
  ready: boolean;
  userId: string | null;
  list: PersonalVersion[];
}

const KEY = "bb.mine.";
let state: State = { ready: false, userId: null, list: [] };
const listeners = new Set<() => void>();
const set = (s: State) => {
  state = s;
  listeners.forEach((l) => l());
};

function clearDeviceCopies(keep?: string) {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(KEY) && k !== keep) localStorage.removeItem(k);
    }
  } catch {
    // storage blocked
  }
}

let inflight: Promise<void> | null = null;
let watching = false;

/** Load (or reload) the player's versions. Safe to call often; requests are shared. */
export function loadMyVersions(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    const db = browserClient();
    if (!watching) {
      watching = true;
      db.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") {
          clearDeviceCopies();
          set({ ready: true, userId: null, list: [] });
        } else if (event === "SIGNED_IN" && !state.userId) setTimeout(() => void loadMyVersions(), 0);
      });
    }
    const {
      data: { session },
    } = await db.auth.getSession();
    if (!session) {
      clearDeviceCopies();
      return set({ ready: true, userId: null, list: [] });
    }
    const userId = session.user.id;
    const key = KEY + userId;
    clearDeviceCopies(key);
    // Show this device's copy at once (no flash of the public chart, works offline)…
    try {
      const cached = localStorage.getItem(key);
      if (cached && (!state.ready || state.userId !== userId)) set({ ready: true, userId, list: JSON.parse(cached) });
    } catch {
      // ignore
    }
    // …then refresh it from the account.
    const { data, error } = await db
      .from("personal_chart_versions")
      .select("song_id, chart_text, note, based_on_revision_id, updated_at, song:songs(slug, title, artist, current_revision_id)")
      .order("updated_at", { ascending: false });
    if (error) {
      // Offline or a network blip: fall back to this device's copy.
      let list: PersonalVersion[] = [];
      try {
        list = JSON.parse(localStorage.getItem(key) ?? "[]");
      } catch {
        // ignore
      }
      return set({ ready: true, userId, list });
    }
    const list: PersonalVersion[] = (data ?? []).flatMap((r) => {
      const s = r.song as unknown as { slug: string; title: string; artist: string | null; current_revision_id: string | null } | null;
      if (!s) return [];
      return [
        {
          song_id: r.song_id,
          chart_text: r.chart_text,
          note: r.note,
          based_on_revision_id: r.based_on_revision_id,
          updated_at: r.updated_at,
          slug: s.slug,
          title: s.title,
          artist: s.artist,
          current_revision_id: s.current_revision_id,
        },
      ];
    });
    try {
      localStorage.setItem(key, JSON.stringify(list));
    } catch {
      // storage full
    }
    set({ ready: true, userId, list });
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (!state.ready && !inflight) void loadMyVersions();
  return () => {
    listeners.delete(l);
  };
}
const SERVER: State = { ready: false, userId: null, list: [] };

export function useMyVersions(): State {
  return useSyncExternalStore(subscribe, () => state, () => SERVER);
}

export function isStale(v: PersonalVersion) {
  return v.based_on_revision_id !== v.current_revision_id;
}

/** Which chart to draw for this song: the player's own version unless they flipped to public. */
export function usePickedChart(slug: string, publicText: string) {
  const { list, ready, userId } = useMyVersions();
  const mine = list.find((v) => v.slug === slug) ?? null;
  const showPublic = usePref(PREF.showPublic(slug), "session") === "1";
  const usingMine = !!mine && !showPublic;
  return {
    ready,
    signedIn: !!userId,
    mine,
    usingMine,
    text: usingMine ? mine.chart_text : publicText,
    stale: mine ? isStale(mine) : false,
    setShowPublic: (on: boolean) => setPref(PREF.showPublic(slug), on ? "1" : null, "session"),
  };
}
