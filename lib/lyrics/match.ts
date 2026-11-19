// Matching a song to lyrics records, and turning synced (LRC) lyrics into plain text.
// Pure: no network, no storage. Lyric text only ever passes through these functions.

export interface LyricsRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string | null;
  duration?: number | null;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

/** Lowercase, no accents, no "(…)"/"[…]", no "feat. …", no punctuation, single spaces. */
export function norm(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/\b(feat|ft|featuring)\b.*$/, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const close = (a: string, b: string) => !!a && !!b && (a === b || a.includes(b) || b.includes(a));

/** Title must match closely; artist too when we know one. */
export function isMatch(title: string, artist: string | null, r: Pick<LyricsRecord, "trackName" | "artistName">): boolean {
  const t = norm(title);
  const rt = norm(r.trackName);
  if (!(t === rt || (Math.min(t.length, rt.length) >= 4 && close(t, rt)))) return false;
  if (!artist) return true;
  return close(norm(artist), norm(r.artistName));
}

export const hasLyrics = (r: LyricsRecord) => !r.instrumental && !!(r.plainLyrics?.trim() || r.syncedLyrics?.trim());

/** Best confident match from a search, or null ("No lyrics found"). Exact title first. */
export function pickBest(title: string, artist: string | null, list: LyricsRecord[]): LyricsRecord | null {
  const ok = list.filter((r) => hasLyrics(r) && isMatch(title, artist, r));
  const raw = (x: string) => x.trim().toLowerCase();
  const t = norm(title);
  // The literal title first (so "Song (Live)" loses to "Song"), then the normalized one.
  return ok.find((r) => raw(r.trackName) === raw(title)) ?? ok.find((r) => norm(r.trackName) === t) ?? ok[0] ?? null;
}

/** "[01:02.34] words" lines -> "words" lines; keeps blank lines between verses. */
export function lrcToPlain(lrc: string): string {
  return lrc
    .split(/\r?\n/)
    .filter((l) => !/^\[(ar|ti|al|by|offset|length|re|ve):/i.test(l.trim()))
    .map((l) => l.replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g, "").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The text to show: plain lyrics when given, else the synced ones without timestamps. */
export function lyricsText(r: LyricsRecord): string | null {
  const plain = r.plainLyrics?.trim();
  if (plain) return plain;
  const synced = r.syncedLyrics?.trim();
  return synced ? lrcToPlain(synced) : null;
}

/** One lyric line to place under the chart's bar rows; `t` = seconds into the song (synced). */
export interface LyricLine {
  t: number | null;
  text: string;
}
/** Most lines a song's lyrics are cut to (placements store line numbers 0..MAX_LINES-1). */
export const MAX_LINES = 500;

const LRC_META = /^\[(ar|ti|al|by|offset|length|re|ve):/i;
const LRC_STAMP = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

/** Synced (LRC) lyrics -> lines in time order. A line with two stamps is sung twice; empty
 *  stamped lines (instrumental breaks) are dropped. */
export function lrcLines(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  let last = 0;
  for (const raw of lrc.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || LRC_META.test(l)) continue;
    const times = [...l.matchAll(LRC_STAMP)].map((m) => Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(`0.${m[3]}`) : 0));
    const text = l.replace(LRC_STAMP, "").trim();
    if (!text) continue;
    if (!times.length) times.push(last);
    for (const t of times) out.push({ t, text });
    last = times.at(-1)!;
  }
  return out.sort((a, b) => a.t! - b.t!).slice(0, MAX_LINES);
}

/** Plain lyrics -> lines, without the blank lines between verses. */
export const plainLines = (s: string): LyricLine[] =>
  s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, MAX_LINES)
    .map((text) => ({ t: null, text }));

/** The lines to place under the bar rows: timed when the record is synced, else plain. */
export function lyricLines(r: LyricsRecord): { lines: LyricLine[]; synced: boolean } {
  const synced = r.syncedLyrics?.trim();
  if (synced) {
    const lines = lrcLines(synced);
    if (lines.length) return { lines, synced: true };
  }
  const plain = r.plainLyrics?.trim();
  return { lines: plain ? plainLines(plain) : [], synced: false };
}
