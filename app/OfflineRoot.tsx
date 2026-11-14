"use client";

import { useEffect } from "react";
import "@/lib/offline/install"; // starts listening for the browser's install prompt on every page
import { dueAgain } from "@/lib/offline/plan";
import { onBackOnline, OFFLINE_MSG, useOffline } from "@/lib/offline/status";
import { clearNote, lastTry, runSync, useSyncStatus } from "@/lib/offline/sync";

/** Ask the service worker to bring the saved app up to date (no-op when nothing changed). */
function refreshApp() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ type: "refresh" })).catch(() => {});
}

/**
 * In the root layout: registers the service worker, keeps the phone's charts in sync (on open,
 * on reconnect, and when coming back after 15+ minutes), and shows the offline strip and the
 * quiet "Updated N songs" note. Stage and play mode cover both.
 */
export default function OfflineRoot() {
  const offline = useOffline();
  const { note } = useSyncStatus();

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {});
    }
    const sync = () => {
      void runSync();
      refreshApp();
    };
    sync();
    const stop = onBackOnline(sync);
    const onShow = () => {
      if (document.visibilityState === "visible" && dueAgain(lastTry, Date.now())) sync();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onShow);
    };
  }, []);

  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(clearNote, 4000);
    return () => window.clearTimeout(t);
  }, [note]);

  return (
    <>
      {offline && (
        <p role="status" data-offline-banner className="bg-amber-400/15 px-4 py-1 text-center text-sm font-semibold text-amber-200">
          Offline, showing saved charts
        </p>
      )}
      {note && (
        <p
          role="status"
          className="pointer-events-none fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-full border border-line bg-panel px-4 py-2 text-base text-foreground shadow-lg"
        >
          Updated {note.n} song{note.n === 1 ? "" : "s"}
        </p>
      )}
    </>
  );
}

/** The one message for anything that needs the server while offline. */
export function OfflineNote({ className = "" }: { className?: string }) {
  return (
    <p role="status" className={`rounded-xl border border-amber-400/50 bg-amber-400/10 px-4 py-3 text-lg text-amber-100 ${className}`}>
      {OFFLINE_MSG}
    </p>
  );
}
