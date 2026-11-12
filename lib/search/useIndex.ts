import { useEffect, useState } from "react";
import { readPref, setPref } from "@/lib/prefs";
import { INDEX_URL, unpackIndex, type SongDoc } from "./pack";

// Loads the song index: the copy saved on this device first (instant, works offline),
// then the fresh file from the server, saved for next time.

const KEY = "bb.index";

export type IndexState = { docs: SongDoc[]; offline: boolean } | { docs: null; offline: boolean };

export function useSongIndex(): IndexState {
  const [state, setState] = useState<IndexState>({ docs: null, offline: false });

  useEffect(() => {
    let cancelled = false;
    const saved = readPref(KEY);
    if (saved) {
      try {
        const docs = unpackIndex(JSON.parse(saved));
        // eslint-disable-next-line react-hooks/set-state-in-effect -- saved copy lives in localStorage (browser only)
        if (docs) setState({ docs, offline: false });
      } catch {
        // corrupt copy: wait for the network
      }
    }
    fetch(INDEX_URL)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((text) => {
        if (cancelled) return;
        const docs = unpackIndex(JSON.parse(text));
        if (!docs) throw new Error("bad index");
        if (text !== saved) {
          setPref(KEY, text);
          setState({ docs, offline: false });
        }
      })
      .catch(() => {
        if (!cancelled) setState((s) => ({ ...s, offline: true }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
