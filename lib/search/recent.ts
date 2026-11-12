import { useMemo } from "react";
import { readPref, setPref, usePref } from "@/lib/prefs";

// Recently viewed songs, kept on this device only: [[slug, time], ...] newest first.

const KEY = "bb.recent";
const MAX = 100;

function parse(raw: string | null): [string, number][] {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((e) => Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "number") : [];
  } catch {
    return [];
  }
}

export function recordRecent(slug: string) {
  const list = parse(readPref(KEY)).filter(([s]) => s !== slug);
  list.unshift([slug, Date.now()]);
  setPref(KEY, JSON.stringify(list.slice(0, MAX)));
}

/** slug -> last viewed time, newest first (Map keeps insertion order). */
export function useRecent(): Map<string, number> {
  const raw = usePref(KEY);
  return useMemo(() => new Map(parse(raw)), [raw]);
}
