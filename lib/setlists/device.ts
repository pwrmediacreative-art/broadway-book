"use client";

// The one setlist a signed-out player keeps on this device (localStorage only).
import { useSyncExternalStore } from "react";
import { MAX_SONGS } from "./play";
import type { Snapshot } from "./snapshot";

const KEY = "bb.setlist.device";

export interface DeviceSetlist extends Snapshot {
  updated_at: string;
}

const listeners = new Set<() => void>();
let cache: { raw: string | null; value: DeviceSetlist | null } = { raw: null, value: null };

function read(): DeviceSetlist | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (raw === cache.raw) return cache.value;
  let value: DeviceSetlist | null = null;
  try {
    const v = raw ? JSON.parse(raw) : null;
    if (v && Array.isArray(v.items)) value = v;
  } catch {
    // bad data: treat as empty
  }
  cache = { raw, value };
  return value;
}

export function saveDeviceSetlist(s: Snapshot | null) {
  try {
    if (!s) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify({ ...s, items: s.items.slice(0, MAX_SONGS), updated_at: new Date().toISOString() }));
  } catch {
    // storage blocked or full
  }
  listeners.forEach((l) => l());
}

/** Append a song; returns false when the list is full. */
export function addToDeviceSetlist(slug: string): boolean {
  const cur = read() ?? { name: "My setlist", gig_date: null, items: [], updated_at: "" };
  if (cur.items.length >= MAX_SONGS) return false;
  saveDeviceSetlist({ ...cur, items: [...cur.items, { slug, key: null, note: null }] });
  return true;
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => e.key === KEY && l();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

/** undefined while rendering on the server / first pass, null when there is no device setlist. */
export function useDeviceSetlist(): DeviceSetlist | null | undefined {
  return useSyncExternalStore(subscribe, read, () => undefined);
}
