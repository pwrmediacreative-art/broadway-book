"use client";

// Keeps the phone's copy of the charts current. First run saves every published chart;
// later runs fetch only songs changed since the last one (offline_sync) and drop songs that
// are no longer published. Then it saves the signed-in player's setlists and refreshes the
// shared links opened on this phone. Failures are quiet: it keeps what it has and tries
// again at the next trigger.
import { useSyncExternalStore } from "react";
import { browserClient } from "@/lib/supabase/browser";
import { fetchSetlist, fetchSharedSetlist, fetchSummaries } from "@/lib/setlists/api";
import { dbAll, dbWriteSongs, kvGet, kvSet, SONGS } from "./db";
import { dropSets, META, rawSavedSet, savedSetKeys, saveSet, saveSummaries, setKey, type SyncMeta } from "./charts";
import { nextSince, planSync, songSig, type SavedSong } from "./plan";
import { isNetworkError, isOffline, reportOffline } from "./status";
import { knownUserId } from "./user";

export interface SyncStatus {
  ready: boolean; // false until the phone's saved state has been read
  phase: "idle" | "saving" | "blocked"; // saving = first download in progress; blocked = storage refused
  saved: number; // charts on this phone (or downloaded so far while saving)
  total: number; // published charts, known while saving
  at: number | null; // last successful sync
  bytes: number;
  note: { n: number; id: number } | null; // "Updated N songs"
}

const START: SyncStatus = { ready: false, phase: "idle", saved: 0, total: 0, at: null, bytes: 0, note: null };
let status = START;
const listeners = new Set<() => void>();
const set = (s: Partial<SyncStatus>) => {
  status = { ...status, ...s };
  listeners.forEach((l) => l());
};

const PAGE = 400;
interface Page {
  now: string;
  total: number;
  slugs: string[] | null;
  songs: SavedSong[];
}

async function syncCharts(): Promise<void> {
  let meta: SyncMeta | undefined;
  let existing: SavedSong[];
  try {
    meta = await kvGet<SyncMeta>(META);
    existing = await dbAll<SavedSong>(SONGS);
  } catch {
    return set({ ready: true, phase: "blocked" });
  }
  const first = !meta;
  if (first) set({ ready: true, phase: "saving", saved: 0, total: 0 });

  const db = browserClient();
  const incoming: SavedSong[] = [];
  let slugs: string[] = [];
  let now = "";
  let after = "";
  for (;;) {
    const { data, error } = await db.rpc("offline_sync", { p_since: meta?.since ?? null, p_after: after, p_limit: PAGE });
    if (error) throw new Error(error.message);
    const page = data as Page;
    if (!after) {
      now = page.now;
      slugs = page.slugs ?? [];
    }
    incoming.push(...page.songs);
    if (first) {
      // Save as we go, so an interrupted first download keeps what it got.
      try {
        await dbWriteSongs(page.songs);
      } catch {
        return set({ ready: true, phase: "blocked" });
      }
      set({ saved: incoming.length, total: page.total });
    }
    if (page.songs.length < PAGE) break;
    after = page.songs[page.songs.length - 1].slug;
  }

  const plan = planSync(new Map(existing.map((s) => [s.slug, songSig(s)])), slugs, incoming);
  let all: SavedSong[];
  try {
    await dbWriteSongs(plan.puts, plan.deletes);
    all = await dbAll<SavedSong>(SONGS);
    const bytes = all.reduce((n, s) => n + JSON.stringify(s).length, 0);
    const next: SyncMeta = { since: nextSince(now), at: Date.now(), count: all.length, bytes };
    await kvSet(META, next);
    set({
      ready: true,
      phase: "idle",
      saved: next.count,
      total: next.count,
      at: next.at,
      bytes,
      note: !first && plan.updated > 0 ? { n: plan.updated, id: Date.now() } : status.note,
    });
  } catch {
    return set({ ready: true, phase: "blocked" });
  }
  // Ask the browser not to clear the saved charts when the phone runs low on space.
  navigator.storage?.persist?.().catch(() => {});
}

async function syncSetlists(): Promise<void> {
  const uid = await knownUserId(browserClient());
  if (uid) {
    const lists = await fetchSummaries();
    await saveSummaries(uid, lists);
    const keep = new Set<string>();
    for (const l of lists) {
      const key = setKey({ uid, id: l.id });
      keep.add(key);
      if ((await rawSavedSet(key))?.updated_at === l.updated_at) continue;
      const full = await fetchSetlist(l.id);
      if (full) await saveSet(key, full);
    }
    await dropSets((await savedSetKeys(`set:u:${uid}:`)).filter((k) => !keep.has(k)));
  } else {
    // Signed out: account setlists don't stay on the phone (same rule as personal versions).
    await dropSets([...(await savedSetKeys("set:u:")), ...(await savedSetKeys("sets:"))]);
  }
  // Shared links opened on this phone: refresh, and forget links that were turned off.
  for (const key of (await savedSetKeys("set:c:")).slice(0, 20)) {
    const full = await fetchSharedSetlist(key.slice("set:c:".length));
    if (full) await saveSet(key, full);
    else await dropSets([key]);
  }
}

let running: Promise<void> | null = null;
export let lastTry = 0;

/** Sync now (shared if one is already running). Never throws. */
export function runSync(): Promise<void> {
  if (running) return running;
  lastTry = Date.now();
  running = (async () => {
    if (isOffline()) return;
    for (const job of [syncCharts, syncSetlists]) {
      try {
        await job();
      } catch (e) {
        if (isNetworkError(e)) reportOffline();
        // First download interrupted: show what is saved so far, retry at the next trigger.
        if (status.phase === "saving") set({ phase: "idle", total: 0 });
      }
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

async function hydrate() {
  try {
    const meta = await kvGet<SyncMeta>(META);
    if (status.ready) return; // a sync got there first
    set(meta ? { ready: true, saved: meta.count, total: meta.count, at: meta.at, bytes: meta.bytes } : { ready: true });
  } catch {
    set({ ready: true, phase: "blocked" });
  }
}

let hydrated = false;
function subscribe(l: () => void) {
  listeners.add(l);
  if (!hydrated) {
    hydrated = true;
    void hydrate();
  }
  return () => {
    listeners.delete(l);
  };
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribe, () => status, () => START);
}

export function clearNote() {
  if (status.note) set({ note: null });
}
