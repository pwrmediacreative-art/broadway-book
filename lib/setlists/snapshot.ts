// Snapshot share links for device-only setlists: the whole list rides in the URL hash
// (never sent to the server). A snapshot can't be changed or revoked; share again to update.
import { MAX_NOTE, MAX_SONGS } from "./play";

export interface SnapItem {
  slug: string;
  key: string | null;
  note: string | null;
}
export interface Snapshot {
  name: string;
  gig_date: string | null;
  items: SnapItem[];
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,120}$/;
const KEY = /^[A-G][b#]?m?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function toB64url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeSnapshot(s: Snapshot): string {
  const i = s.items.slice(0, MAX_SONGS).map((it) => {
    const row: (string | null)[] = [it.slug, it.key ?? null, it.note?.trim() || null];
    while (row.length > 1 && row[row.length - 1] === null) row.pop();
    return row;
  });
  return toB64url(JSON.stringify({ v: 1, n: s.name.slice(0, 100), d: s.gig_date, i }));
}

/** Parse a snapshot hash; anything malformed is dropped rather than trusted. */
export function decodeSnapshot(hash: string): Snapshot | null {
  try {
    const raw = JSON.parse(fromB64url(hash.replace(/^#/, "")));
    if (!raw || raw.v !== 1 || !Array.isArray(raw.i)) return null;
    const str = (x: unknown) => (typeof x === "string" ? x : null);
    const items: SnapItem[] = [];
    for (const r of raw.i.slice(0, MAX_SONGS)) {
      if (!Array.isArray(r)) continue;
      const slug = str(r[0]);
      if (!slug || !SLUG.test(slug)) continue;
      const key = str(r[1]);
      const note = str(r[2]);
      items.push({ slug, key: key && KEY.test(key) ? key : null, note: note ? note.slice(0, MAX_NOTE) : null });
    }
    const d = str(raw.d);
    return { name: (str(raw.n) ?? "").slice(0, 100) || "Shared setlist", gig_date: d && DATE.test(d) ? d : null, items };
  } catch {
    return null;
  }
}
