// Where a page goes when there is no connection. Pure, so it can be tested; the service
// worker (public/sw.js) carries the same table and a test keeps the two in step.

/** Pages saved whole on the phone and shown as they are. */
export const SHELLS = [
  "/",
  "/setlists",
  "/setlists/device",
  "/setlists/device/play",
  "/setlists/snapshot",
  "/offline",
  "/offline/song",
  "/offline/setlist",
];

export type OfflineTarget = { serve: string } | { redirect: string };

const enc = encodeURIComponent;

/**
 * serve: show that saved page at this address. redirect: go to a saved page that draws the
 * chart or setlist from the phone's copy. Everything else lands on the "You're offline" page.
 */
export function offlineTarget(pathname: string): OfflineTarget {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (SHELLS.includes(path)) return { serve: path };
  let m = /^\/songs\/([^/]+)(\/stage)?$/.exec(path);
  if (m) return { redirect: `/offline/song?s=${enc(decodeURIComponent(m[1]))}${m[2] ? "&stage=1" : ""}` };
  m = /^\/setlists\/([^/]+)(\/play)?$/.exec(path);
  if (m) return { redirect: `/offline/setlist?id=${enc(decodeURIComponent(m[1]))}${m[2] ? "&play=1" : ""}` };
  m = /^\/s\/([^/]+)(\/play)?$/.exec(path);
  if (m) return { redirect: `/offline/setlist?code=${enc(decodeURIComponent(m[1]))}${m[2] ? "&play=1" : ""}` };
  return { redirect: `/offline?from=${enc(path)}` };
}

/** The in-place address for a song link while on the saved-chart page, or null for other links. */
export function savedSongHref(pathname: string): string | null {
  const t = offlineTarget(pathname);
  return "redirect" in t && t.redirect.startsWith("/offline/song?") ? t.redirect : null;
}
