// Pure pieces of the offline step (no browser APIs), shared by the sync, the status line,
// the install card and the tests.

/** A published chart as the phone keeps it. */
export interface SavedSong {
  id: string;
  slug: string;
  title: string;
  artist: string | null;
  key: string | null;
  is_example: boolean;
  unverified: boolean;
  updated_at: string;
  chart_text: string;
}

/** What a player would notice changing (everything except the timestamp). */
export const songSig = (s: SavedSong) =>
  JSON.stringify([s.id, s.title, s.artist, s.key, s.is_example, s.unverified, s.chart_text]);

/**
 * Work out one sync: which rows to save, which saved slugs to drop, and how many songs
 * changed for the "Updated N songs" note (new + changed + removed).
 * `saved` maps slug -> signature of the copy on the phone.
 */
export function planSync(saved: Map<string, string>, publishedSlugs: string[], incoming: SavedSong[]) {
  const live = new Set(publishedSlugs);
  const puts = incoming.filter((s) => live.has(s.slug) && saved.get(s.slug) !== songSig(s));
  const deletes = [...saved.keys()].filter((slug) => !live.has(slug));
  return { puts, deletes, updated: puts.length + deletes.length };
}

/** Next sync asks for changes since a little before this one started, so nothing slips between. */
export function nextSince(serverNow: string, overlapMs = 5 * 60_000): string {
  return new Date(new Date(serverNow).getTime() - overlapMs).toISOString();
}

/** "just now", "5 min ago", "2 hours ago", "3 days ago". */
export function ago(then: number, now: number): string {
  const min = Math.floor(Math.max(0, now - then) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/** "640 KB", "1.2 MB". */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const count = (n: number) => n.toLocaleString("en-US");

export type InstallKind = "installed" | "ios" | "android" | "other";

/** Which install instructions fit this phone. iPads report as Macs with a touch screen. */
export function installKind(ua: string, maxTouchPoints: number, standalone: boolean): InstallKind {
  if (standalone) return "installed";
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

/** Should a sync run when the app comes back to the front? (15+ minutes since the last try.) */
export const dueAgain = (lastTry: number, now: number) => now - lastTry >= 15 * 60_000;
