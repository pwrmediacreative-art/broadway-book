/**
 * Dropbox chart filenames -> title + artist.
 * The folder's pattern is "Title - Artist.pdf". Junk that copies and exports add
 * ("Copy of", "(1)", "(… conflicted copy)", "- chords", "- Jan 14, 2014, 1-30 PM") is
 * stripped. A name with no artist comes back with artist null: the Unparsed list.
 */
export interface ParsedName {
  title: string | null;
  artist: string | null;
}

// A dash with a space on at least one side. "Ex-Girlfriend" and "BlueSky-AllmanBros" don't split.
const SEPARATOR = /\s+-\s*|\s*-\s+/;
// Words tacked onto the end of a name that aren't part of it.
// "Taylor Swift (chords)", "Eric Church 001", "Tim Montana0001" (scanner page numbers start with 0).
const TRAILING_JUNK = /(\s+|\s*\()(chords?|chart|lyrics|nns|numbers?)\)?$|\s*0\d{2,3}$|\s*\*+$/i;

function tidy(s: string): string {
  let out = s.replace(/\s+/g, " ").trim();
  while (TRAILING_JUNK.test(out)) out = out.replace(TRAILING_JUNK, "").trim();
  return out.replace(/^[-\s]+|[-\s]+$/g, "");
}

export function parseFilename(fileName: string): ParsedName {
  let name = fileName.replace(/\.pdf$/i, "").replace(/\.(jpe?g|png)$/i, "");
  name = name.replace(/\s*\([^)]*conflicted copy[^)]*\)/gi, "");
  name = name.replace(/^\s*copy of\s+/i, "");
  while (/\s*\(\d+\)\s*$/.test(name)) name = name.replace(/\s*\(\d+\)\s*$/, "");

  const parts = name.split(SEPARATOR);
  const title = tidy(parts[0] ?? "") || null;
  // Only the first segment after the title is the artist; later ones are "chords", dates, etc.
  const artistRaw = parts.length > 1 ? tidy(parts[1]) : "";
  const artist = artistRaw ? artistRaw.replace(/\s*:\s*/g, " & ") : null;
  return { title, artist };
}

export function isParsed(p: ParsedName): boolean {
  return p.title !== null && p.artist !== null;
}
