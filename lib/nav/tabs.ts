// The app's four tabs (bottom bar on phones and tablets, side rail on desktop). Pure, so the
// "which tab is lit" and "where is the bar hidden" rules can be tested.

export type TabId = "home" | "setlists" | "community" | "settings";

export const TABS: { id: TabId; href: string; label: string }[] = [
  { id: "home", href: "/", label: "Home" },
  { id: "setlists", href: "/setlists", label: "Setlists" },
  { id: "community", href: "/community", label: "Community" },
  { id: "settings", href: "/settings", label: "Settings" },
];

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

/**
 * Full-screen pages that bring their own ✕ / back: stage mode, setlist play mode, the print
 * view. (The saved offline pages switch into stage/play with a query string; StageView and
 * PlayView hide the bar themselves through `data-full` on <html>.)
 */
export function hidesTabs(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  return /^\/(?:songs|mine)\/[^/]+\/stage$|^\/(?:setlists|s)\/[^/]+\/play$|^\/upload\/[^/]+\/print$/.test(p);
}

/** Which tab a page belongs to (null: none lit, e.g. the sign-in callback). */
export function tabFor(pathname: string): TabId | null {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/" || under(p, "/songs") || under(p, "/mine") || under(p, "/make") || under(p, "/upload") || under(p, "/c") || under(p, "/offline/song") || under(p, "/offline/mine"))
    return "home";
  if (under(p, "/setlists") || under(p, "/s") || under(p, "/offline/setlist")) return "setlists";
  if (under(p, "/community") || under(p, "/notifications")) return "community";
  if (under(p, "/settings") || under(p, "/profile") || under(p, "/notes") || under(p, "/admin") || under(p, "/login")) return "settings";
  return null;
}

/** Badge text: 1–9, then "9+". */
export const badge = (n: number) => (n > 9 ? "9+" : String(n));

/** Fire after a vote (or anything that changes "waiting for your vote") to refresh the badge. */
export const VOTES_EVENT = "bb:votes";
