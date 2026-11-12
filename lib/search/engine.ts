import MiniSearch from "minisearch";
import type { SongDoc } from "./pack";

// Typo-tolerant, any-order search over title / artist (plus feel and tags, weighted low).

/** Lowercase, strip accents and apostrophes, "&" -> "and". */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/&/g, " and ");
}

const tokenize = (s: string) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);

// Short words must be typed right ("hey" != "hay"); longer ones forgive 1-2 typos.
const fuzzy = (term: string) => (term.length < 4 ? 0 : term.length < 7 ? 1 : 2);

export interface SearchEngine {
  /** Slugs best match first. Empty query -> null (no search active). */
  search(q: string): string[] | null;
}

export function createEngine(docs: SongDoc[]): SearchEngine {
  const ms = new MiniSearch<SongDoc>({
    idField: "slug",
    fields: ["title", "artist", "feel", "tags"],
    extractField: (d, f) => {
      const v = d[f as keyof SongDoc];
      return Array.isArray(v) ? v.join(" ") : ((v as string | null) ?? "");
    },
    tokenize,
    processTerm: (t) => t,
    searchOptions: {
      boost: { title: 3, artist: 2, feel: 0.5, tags: 0.5 },
      prefix: true,
      fuzzy,
      maxFuzzy: 2,
    },
  });
  ms.addAll(docs);

  return {
    search(q) {
      if (!tokenize(q).length) return null;
      // Every word must match somewhere; if a heavy typo kills that, fall back to "any word".
      let hits = ms.search(q, { combineWith: "AND" });
      // Mid-word typo ("wagi" while typing "wagin"): retry with the last word shortened.
      for (let t = q.trimEnd(); !hits.length && /[a-z0-9]{4,}$/i.test(t); ) {
        t = t.slice(0, -1);
        hits = ms.search(t, { combineWith: "AND" });
      }
      if (!hits.length) hits = ms.search(q, { combineWith: "OR" });
      return hits.map((h) => h.id as string);
    },
  };
}
