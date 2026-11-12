// The search index file: every published song as a short array, so ~1,900 songs stay small.
// Row = [slug, title, artist, key, bpm, time, feel, tags ("a,b"), example (1)].
// Missing values are "" / 0, and trailing empties are dropped.

export const INDEX_URL = "/search-index.json";

export interface SongDoc {
  slug: string;
  title: string;
  artist: string | null;
  key: string | null;
  bpm: number | null;
  time: string | null;
  feel: string | null;
  tags: string[];
  ex: boolean;
}

/** One `songs` row as the server reads it. */
export interface IndexRow {
  slug: string;
  title: string;
  artist: string | null;
  key: string | null;
  bpm: number | null;
  time_sig: string | null;
  feel: string | null;
  tags: string[] | null;
  is_example: boolean;
}

type Cell = string | number;
export interface PackedIndex {
  v: 1;
  s: Cell[][];
}

export function packIndex(rows: IndexRow[]): PackedIndex {
  return {
    v: 1,
    s: rows.map((r) => {
      const row: Cell[] = [
        r.slug,
        r.title,
        r.artist ?? "",
        r.key ?? "",
        r.bpm ?? 0,
        r.time_sig ?? "",
        r.feel ?? "",
        (r.tags ?? []).join(","),
        r.is_example ? 1 : 0,
      ];
      while (row.length > 2 && (row[row.length - 1] === "" || row[row.length - 1] === 0)) row.pop();
      return row;
    }),
  };
}

const str = (c: Cell | undefined) => (typeof c === "string" && c !== "" ? c : null);

export function unpackIndex(p: unknown): SongDoc[] | null {
  if (!p || typeof p !== "object" || (p as PackedIndex).v !== 1 || !Array.isArray((p as PackedIndex).s)) return null;
  return (p as PackedIndex).s
    .filter((r) => Array.isArray(r) && typeof r[0] === "string" && typeof r[1] === "string")
    .map((r) => ({
      slug: r[0] as string,
      title: r[1] as string,
      artist: str(r[2]),
      key: str(r[3]),
      bpm: typeof r[4] === "number" && r[4] > 0 ? r[4] : null,
      time: str(r[5]),
      feel: str(r[6]),
      tags: str(r[7])?.split(",").filter(Boolean) ?? [],
      ex: r[8] === 1,
    }));
}
