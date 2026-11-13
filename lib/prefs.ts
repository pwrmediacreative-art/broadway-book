import { useSyncExternalStore } from "react";

// Per-device settings in localStorage (and per-tab state in sessionStorage).
// Every access is wrapped: private mode or blocked storage just falls back to defaults.

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

type Area = "local" | "session";
const store = (area: Area): Storage | null => {
  try {
    return area === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
};

export function readPref(key: string, area: Area = "local"): string | null {
  try {
    return store(area)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function setPref(key: string, value: string | null, area: Area = "local") {
  try {
    const s = store(area);
    if (value === null) s?.removeItem(key);
    else s?.setItem(key, value);
  } catch {
    // ignore: storage full or blocked
  }
  notify();
}

/** Live value of a stored setting. Renders null on the server and on first hydration pass. */
export function usePref(key: string, area: Area = "local"): string | null {
  return useSyncExternalStore(
    subscribe,
    () => readPref(key, area),
    () => null,
  );
}

export const PREF = {
  display: "bb.display", // "numbers" | "chords"
  minorSymbol: "bb.minor", // "-" | "m" (default "m"): how minor numbers are drawn
  legend: "bb.legend", // "1" = symbols legend open
  font: "bb.font", // FontId
  size: "bb.size", // stage text size in px; unset = auto-fit
  speed: "bb.speed", // last scroll speed 1-12
  pulse: "bb.pulse", // "1" = beat pulse on
  stageTheme: "bb.stageTheme", // "light" | unset = dark (stage mode only)
  key: (slug: string) => `bb.key.${slug}`,
  numbering: (slug: string) => `bb.numbers.${slug}`, // "minor" | "relative"; unset = as the chart is written
  songSpeed: (slug: string) => `bb.speed.${slug}`,
  showPublic: (slug: string) => `bb.public.${slug}`, // sessionStorage: "1" = show the public chart, not my version
  nav: "bb.nav", // sessionStorage: [{slug,title}] list the player opened a song from
} as const;
