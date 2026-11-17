// "My notes": a player's flags and own chart versions, grouped by song, most recent first
// (DECISIONS Q4 option B). Pure, so it's tested without a browser.

export interface NoteFlag {
  id: string;
  slug: string;
  ref: { section: number; label: string; bar: number; beat: number; text: string };
  note: string | null;
  created_at: string;
}
export interface NoteVersion {
  slug: string;
  title: string;
  artist: string | null;
  updated_at: string;
  stale: boolean;
}
export type NoteFilter = "all" | "flags" | "versions";
export interface SongNotes {
  slug: string;
  title: string;
  artist: string | null;
  latest: string; // ISO time of the newest flag or version edit
  flags: NoteFlag[]; // in chart order
  version: NoteVersion | null;
}

export function groupNotes(
  flags: NoteFlag[],
  versions: NoteVersion[],
  names: (slug: string) => { title: string; artist: string | null } | null,
  filter: NoteFilter = "all",
): SongNotes[] {
  const by = new Map<string, SongNotes>();
  const song = (slug: string, fallback?: { title: string; artist: string | null }) => {
    let g = by.get(slug);
    if (!g) {
      const n = fallback ?? names(slug) ?? { title: slug, artist: null };
      g = { slug, title: n.title, artist: n.artist, latest: "", flags: [], version: null };
      by.set(slug, g);
    }
    return g;
  };
  if (filter !== "versions") {
    for (const f of flags) {
      const g = song(f.slug);
      g.flags.push(f);
      if (f.created_at > g.latest) g.latest = f.created_at;
    }
  }
  if (filter !== "flags") {
    for (const v of versions) {
      const g = song(v.slug, { title: v.title, artist: v.artist });
      g.version = v;
      if (v.updated_at > g.latest) g.latest = v.updated_at;
    }
  }
  const out = [...by.values()];
  for (const g of out) g.flags.sort((a, b) => a.ref.section - b.ref.section || a.ref.bar - b.ref.bar || a.ref.beat - b.ref.beat);
  return out.sort((a, b) => (a.latest < b.latest ? 1 : a.latest > b.latest ? -1 : a.title.localeCompare(b.title)));
}

/** "Today", "Yesterday", or "Nov 12" (with the year when it isn't this year), in local time. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
}

/** The song-page address that scrolls to a flagged spot. */
export const flagHref = (f: Pick<NoteFlag, "slug" | "ref">) => `/songs/${f.slug}#at=${f.ref.section}.${f.ref.bar}.${f.ref.beat}`;
