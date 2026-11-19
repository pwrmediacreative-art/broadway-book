import "server-only";

// The one place the app gets lyrics. Screens and routes only use `findLyrics` and
// `lyricsCandidates`, so a licensed provider (Musixmatch, LyricFind) can replace LRCLIB here
// without changing them. Lyrics are returned to the caller and never stored.
import { getById, getTrack, searchTracks } from "./lrclib";
import { hasLyrics, isMatch, lyricLines, lyricsText, norm, pickBest, type LyricLine, type LyricsRecord } from "./match";

export interface Found {
  text: string; // the whole text (side panel)
  lines: LyricLine[]; // the lines placed under the chart's bar rows (Q18), timed when synced
  synced: boolean;
  source: { provider: "LRCLIB"; id: number; title: string; artist: string; album: string | null };
}
export interface Candidate {
  id: number;
  title: string;
  artist: string;
  album: string | null;
  seconds: number | null;
  hasLyrics: boolean;
}

const found = (r: LyricsRecord): Found | null => {
  const text = lyricsText(r);
  return text
    ? { text, ...lyricLines(r), source: { provider: "LRCLIB", id: r.id, title: r.trackName, artist: r.artistName, album: r.albumName ?? null } }
    : null;
};

/** Lyrics for a song: the admin's pinned record, else an exact match, else a close search hit. */
export async function findLyrics(title: string, artist: string | null, pinnedId: number | null): Promise<Found | null> {
  if (pinnedId) {
    const r = await getById(pinnedId);
    return r && hasLyrics(r) ? found(r) : null;
  }
  if (artist) {
    const exact = await getTrack(title, artist);
    if (exact && hasLyrics(exact) && isMatch(title, artist, exact)) return found(exact);
  }
  const best = pickBest(title, artist, await searchTracks(title, artist));
  return best ? found(best) : null;
}

/** "Wrong lyrics? Pick another": search by title only, so other artists' records show too. */
export async function lyricsCandidates(title: string, artist: string | null): Promise<Candidate[]> {
  const list = await searchTracks(title, null);
  const a = norm(artist);
  return list
    .map((r) => ({
      id: r.id,
      title: r.trackName,
      artist: r.artistName,
      album: r.albumName ?? null,
      seconds: r.duration ? Math.round(r.duration) : null,
      hasLyrics: hasLyrics(r),
      same: !!a && norm(r.artistName).includes(a),
    }))
    .sort((x, y) => Number(y.same) - Number(x.same) || Number(y.hasLyrics) - Number(x.hasLyrics))
    .map((c) => ({ id: c.id, title: c.title, artist: c.artist, album: c.album, seconds: c.seconds, hasLyrics: c.hasLyrics }));
}
