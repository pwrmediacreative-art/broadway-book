"use client";

// Personal flags ("Flag for me"): private marks on one spot of a chart, with an optional note.
// Signed out: kept on this device only. Signed in: kept in the account (RLS: owner only) with a
// copy on this device per user, so they show offline. Signed-out flags stay on the device until
// the player moves them to their account. Never public, never part of proposals or votes.
import { useSyncExternalStore } from "react";
import { browserClient } from "@/lib/supabase/browser";
import type { BarRef } from "./ref";

export const NOTE_MAX = 60;

export interface PersonalFlag {
  id: string;
  slug: string;
  ref: BarRef;
  note: string | null;
  onMine: boolean; // flagged while viewing the player's own version
  created_at: string;
}

interface State {
  ready: boolean;
  userId: string | null;
  flags: PersonalFlag[]; // what this player sees: the account's when signed in, else the device's
  guest: PersonalFlag[]; // signed-out flags still on this device
}

const GUEST = "bb.flags.guest";
const ACCOUNT = "bb.flags.u.";
let state: State = { ready: false, userId: null, flags: [], guest: [] };
const listeners = new Set<() => void>();
const set = (s: Partial<State>) => {
  state = { ...state, ...s };
  listeners.forEach((l) => l());
};

function read(key: string): PersonalFlag[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function write(key: string, list: PersonalFlag[]) {
  try {
    if (list.length) localStorage.setItem(key, JSON.stringify(list));
    else localStorage.removeItem(key);
  } catch {
    // storage full or blocked
  }
}
function clearAccountCopies(keep?: string) {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(ACCOUNT) && k !== keep) localStorage.removeItem(k);
    }
  } catch {
    // storage blocked
  }
}
const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Row = {
  id: string;
  section_index: number;
  section_label: string;
  bar_index: number;
  beat_index: number;
  item_text: string;
  note: string | null;
  revision_id: string | null;
  created_at: string;
  song: { slug: string } | null;
};
const COLS = "id, section_index, section_label, bar_index, beat_index, item_text, note, revision_id, created_at, song:songs(slug)";
const fromRow = (r: Row): PersonalFlag | null =>
  r.song
    ? {
        id: r.id,
        slug: r.song.slug,
        ref: { section: r.section_index, label: r.section_label, bar: r.bar_index, beat: r.beat_index, text: r.item_text },
        note: r.note,
        onMine: r.revision_id === null,
        created_at: r.created_at,
      }
    : null;

let inflight: Promise<void> | null = null;
let watching = false;

/** Load (or reload) the player's flags. Requests are shared. */
export function loadFlags(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    const db = browserClient();
    if (!watching) {
      watching = true;
      db.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") {
          clearAccountCopies();
          const guest = read(GUEST);
          set({ ready: true, userId: null, flags: guest, guest });
        } else if (event === "SIGNED_IN" && !state.userId) setTimeout(() => void loadFlags(), 0);
      });
    }
    const guest = read(GUEST);
    const {
      data: { session },
    } = await db.auth.getSession();
    if (!session) {
      clearAccountCopies();
      return set({ ready: true, userId: null, flags: guest, guest });
    }
    const userId = session.user.id;
    const key = ACCOUNT + userId;
    clearAccountCopies(key);
    if (!state.ready || state.userId !== userId) set({ ready: true, userId, flags: read(key), guest });
    const { data, error } = await db.from("personal_flags").select(COLS).order("created_at");
    if (error) return set({ ready: true, userId, flags: read(key), guest }); // offline: device copy
    const flags = ((data ?? []) as unknown as Row[]).flatMap((r) => fromRow(r) ?? []);
    write(key, flags);
    set({ ready: true, userId, flags, guest });
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (!state.ready && !inflight) void loadFlags();
  return () => {
    listeners.delete(l);
  };
}
const SERVER: State = { ready: false, userId: null, flags: [], guest: [] };
const useFlagState = () => useSyncExternalStore(subscribe, () => state, () => SERVER);

/** This player's flags on one song, plus how many signed-out flags wait to be moved. */
export function useSongFlags(slug: string) {
  const s = useFlagState();
  return {
    ready: s.ready,
    signedIn: !!s.userId,
    flags: s.flags.filter((f) => f.slug === slug),
    waiting: s.userId ? s.guest.length : 0,
  };
}

const cleanNote = (note: string) => {
  const n = note.trim().slice(0, NOTE_MAX);
  return n === "" ? null : n;
};
const setFlags = (flags: PersonalFlag[]) => {
  if (state.userId) write(ACCOUNT + state.userId, flags);
  else write(GUEST, flags);
  set(state.userId ? { flags } : { flags, guest: flags });
};
const sameSpot = (a: PersonalFlag, slug: string, r: BarRef) =>
  a.slug === slug && a.ref.section === r.section && a.ref.bar === r.bar && a.ref.beat === r.beat;

const songIds = new Map<string, { id: string; revision: string | null }>();
/** The song's id and live revision; null when it isn't published, undefined when offline. */
async function songFor(slug: string) {
  const hit = songIds.get(slug);
  if (hit) return hit;
  const { data, error } = await browserClient().from("songs").select("id, current_revision_id").eq("slug", slug).maybeSingle();
  if (error) return undefined;
  if (!data) return null;
  const v = { id: data.id as string, revision: (data.current_revision_id as string | null) ?? null };
  songIds.set(slug, v);
  return v;
}

/** Flag one spot. Returns an error message, or null when saved. */
export async function addFlag(slug: string, ref: BarRef, note: string, onMine: boolean): Promise<string | null> {
  if (state.flags.some((f) => sameSpot(f, slug, ref))) return null;
  const flag: PersonalFlag = { id: newId(), slug, ref, note: cleanNote(note), onMine, created_at: new Date().toISOString() };
  if (!state.userId) {
    setFlags([...state.flags, flag]);
    return null;
  }
  const song = await songFor(slug);
  if (!song) return "Couldn't save the flag. Check your connection.";
  const { data, error } = await browserClient()
    .from("personal_flags")
    .insert({
      song_id: song.id,
      revision_id: onMine ? null : song.revision,
      section_index: ref.section,
      section_label: ref.label,
      bar_index: ref.bar,
      beat_index: ref.beat,
      item_text: ref.text,
      note: flag.note,
    })
    .select(COLS)
    .single();
  if (error || !data) return error?.message.includes("200 flags") ? "You can keep up to 200 flags on one song." : "Couldn't save the flag. Check your connection.";
  const saved = fromRow(data as unknown as Row);
  if (saved) setFlags([...state.flags, saved]);
  return null;
}

export async function setFlagNote(id: string, note: string): Promise<string | null> {
  const n = cleanNote(note);
  if (state.userId) {
    const { error } = await browserClient().from("personal_flags").update({ note: n }).eq("id", id);
    if (error) return "Couldn't save the note. Check your connection.";
  }
  setFlags(state.flags.map((f) => (f.id === id ? { ...f, note: n } : f)));
  return null;
}

export async function removeFlags(ids: string[]): Promise<string | null> {
  if (!ids.length) return null;
  if (state.userId) {
    const { error } = await browserClient().from("personal_flags").delete().in("id", ids);
    if (error) return "Couldn't clear. Check your connection.";
  }
  setFlags(state.flags.filter((f) => !ids.includes(f.id)));
  return null;
}

/** Move this device's signed-out flags into the account. A spot already flagged there keeps the account's flag. */
export async function moveGuestFlags(): Promise<string | null> {
  if (!state.userId || !state.guest.length) return null;
  const rows = [];
  for (const f of state.guest) {
    const song = await songFor(f.slug);
    if (song === undefined) return "Couldn't move your flags. Check your connection and try again.";
    if (!song) continue; // song no longer published: nothing to attach the flag to
    rows.push({
      song_id: song.id,
      revision_id: f.onMine ? null : song.revision,
      section_index: f.ref.section,
      section_label: f.ref.label,
      bar_index: f.ref.bar,
      beat_index: f.ref.beat,
      item_text: f.ref.text,
      note: f.note,
    });
  }
  const { error } = !rows.length ? { error: null } : await browserClient()
    .from("personal_flags")
    .upsert(rows, { onConflict: "user_id,song_id,section_index,bar_index,beat_index", ignoreDuplicates: true });
  if (error) return "Couldn't move your flags. Check your connection and try again.";
  write(GUEST, []);
  set({ guest: [] });
  await loadFlags();
  return null;
}
