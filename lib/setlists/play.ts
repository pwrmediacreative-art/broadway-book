// Pure setlist logic shared by the editor, play mode and tests. No React, no network.
import { buildView, getMeta, keyPickerOptions, MAX_CUE_WORDS, parseChart, parseKey, type ChartView } from "../chart";

export const MAX_SONGS = 100;
export const MAX_NOTE = 60;

/** A published song as a setlist needs it (null in an item = no longer available). */
export interface SetSong {
  slug: string;
  title: string;
  artist: string | null;
  key: string | null;
  chart_text: string;
}

export interface SetItem {
  song_id?: string; // account setlists only
  slug: string | null; // null only when the song is no longer published
  key: string | null; // setlist key override (in the song's own mode), null = chart's key
  note: string | null;
  song: SetSong | null;
}

export interface PlaySet {
  name: string;
  gig_date: string | null; // YYYY-MM-DD
  items: SetItem[];
}

/** Indexes of the items play mode visits, in order (songs that are no longer published are skipped). */
export function playOrder(items: SetItem[]): number[] {
  return items.flatMap((it, i) => (it.song ? [i] : []));
}

/** Position in `order` after moving `dir`; null when that would go past either end (no wrapping). */
export function step(order: number[], pos: number, dir: -1 | 1): number | null {
  const next = pos + dir;
  return next >= 0 && next < order.length ? next : null;
}

/** Header text for play mode: "3 of 18" plus the next song's title (null on the last song). */
export function playLabel(items: SetItem[], order: number[], pos: number): { count: string; next: string | null } {
  const n = step(order, pos, 1);
  return { count: `${pos + 1} of ${order.length}`, next: n === null ? null : (items[order[n]].song?.title ?? null) };
}

/** Where play mode starts for an item index (or the first playable song). */
export function startPos(order: number[], itemIndex: number | null): number {
  if (itemIndex === null) return 0;
  const p = order.indexOf(itemIndex);
  return p >= 0 ? p : 0;
}

export function noteCheck(note: string): { error: string | null; warning: string | null } {
  const t = note.trim();
  if (t.length > MAX_NOTE) return { error: `Notes are ${MAX_NOTE} characters or fewer.`, warning: null };
  const words = t ? t.split(/\s+/).length : 0;
  return {
    error: null,
    warning: words > MAX_CUE_WORDS ? `Long note (${words} words). Keep it to ${MAX_CUE_WORDS} words or fewer: no lyrics.` : null,
  };
}

/** The chart's own key and numbering, read from the chart text (what the key picker is based on). */
export function chartKeyInfo(chartText: string) {
  try {
    const meta = getMeta(parseChart(chartText).doc);
    return { key: meta.key ?? null, numbers: meta.numbers };
  } catch {
    return { key: null, numbers: "minor" as const };
  }
}

/** Key choices for a setlist row (same list as the song page), or [] when the chart has no key. */
export function keyOptions(chartText: string) {
  const { key, numbers } = chartKeyInfo(chartText);
  const original = key ? parseKey(key) : null;
  if (!original) return [];
  return keyPickerOptions(original, original.minor ? numbers : "minor").map((o) => ({ ...o, orig: o.value === key }));
}

/** Key to show for a row: the override if it is valid for this chart, else the chart's key. */
export function shownKey(item: SetItem): string | null {
  if (!item.song) return item.key;
  const own = chartKeyInfo(item.song.chart_text).key;
  if (!item.key) return own;
  const k = parseKey(item.key);
  const o = own ? parseKey(own) : null;
  return k && o && k.minor === o.minor ? item.key : own;
}

/** The chart view play mode draws for an item with an optional in-session key change. */
export function itemView(item: SetItem, sessionKey?: string | null): ChartView | null {
  if (!item.song) return null;
  try {
    return buildView(parseChart(item.song.chart_text).doc, { key: sessionKey ?? item.key });
  } catch {
    return null;
  }
}
