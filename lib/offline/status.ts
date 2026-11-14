"use client";

// Is the app offline right now? True in airplane mode AND on Wi-Fi with no internet: the
// browser's own flag only knows about the first, so we also ask the server for a tiny file.
import { useSyncExternalStore } from "react";

export const OFFLINE_MSG = "You're offline. This needs a connection.";

let offline = typeof navigator !== "undefined" && navigator.onLine === false;
let started = false;
let timer: number | null = null;
let checking: Promise<boolean> | null = null;
const listeners = new Set<() => void>();
const onlineListeners = new Set<() => void>();

function set(v: boolean) {
  if (v === offline) return;
  offline = v;
  listeners.forEach((l) => l());
  if (!v) onlineListeners.forEach((l) => l());
}

async function reach(): Promise<boolean> {
  const ctl = new AbortController();
  const t = window.setTimeout(() => ctl.abort(), 5000);
  try {
    // The service worker never answers this one (it only handles GET), so it proves the network.
    const r = await fetch("/sw.js", { method: "HEAD", cache: "no-store", signal: ctl.signal });
    return r.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(t);
  }
}

/** Ask now. Resolves true when offline. While offline it keeps asking every 10 seconds. */
export function checkOffline(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (checking) return checking;
  checking = (async () => {
    const off = navigator.onLine === false || !(await reach());
    set(off);
    if (timer) window.clearTimeout(timer);
    timer = off ? window.setTimeout(() => void checkOffline(), 10_000) : null;
    return off;
  })().finally(() => {
    checking = null;
  });
  return checking;
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("offline", () => void checkOffline());
  window.addEventListener("online", () => void checkOffline());
  void checkOffline();
}

/** Last known answer (no waiting). */
export function isOffline(): boolean {
  start();
  return offline;
}

/** A request just failed for lack of a network: show offline now, then keep checking. */
export function reportOffline() {
  if (typeof window === "undefined") return;
  start();
  set(true);
  void checkOffline();
}

/** Did this error come from having no network (as opposed to the server saying no)? */
export function isNetworkError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : typeof e === "string" ? e : ((e as { message?: string } | null)?.message ?? "");
  return /failed to fetch|load failed|networkerror|network request failed|fetch failed/i.test(m);
}

/** Run `cb` each time the connection comes back. */
export function onBackOnline(cb: () => void): () => void {
  start();
  onlineListeners.add(cb);
  return () => {
    onlineListeners.delete(cb);
  };
}

function subscribe(l: () => void) {
  start();
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Live offline flag. False on the server and on the first render. */
export function useOffline(): boolean {
  return useSyncExternalStore(subscribe, () => offline, () => false);
}
