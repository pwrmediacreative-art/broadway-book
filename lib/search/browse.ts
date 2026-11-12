import type { SongDoc } from "./pack";

// Filters, sorting, facets and URL state for the home page. Pure functions, all in the browser.

// ── keys ────────────────────────────────────────────────────────────────────
const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJOR = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MINOR = ["Cm", "C#m", "Dm", "Ebm", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "Bbm", "Bm"];

/** "A#" -> "Bb", "Dbm"/"C#-" -> "C#m". Major and minor stay apart. Null if unreadable. */
export function canonKey(k: string | null): string | null {
  const m = k?.trim().match(/^([A-Ga-g])([#b♯♭]?)\s*(m|min|minor|-)?$/);
  if (!m) return null;
  const acc = m[2] === "#" || m[2] === "♯" ? 1 : m[2] === "b" || m[2] === "♭" ? -1 : 0;
  const pc = (PC[m[1].toUpperCase()] + acc + 12) % 12;
  return (m[3] ? MINOR : MAJOR)[pc];
}

/** Sort position: C, Cm, Db, C#m, D, Dm ... unknown last. */
export function keyOrder(k: string | null): number {
  const c = canonKey(k);
  if (!c) return 99;
  const i = MAJOR.indexOf(c);
  return i >= 0 ? i * 2 : MINOR.indexOf(c) * 2 + 1;
}

// ── filters ─────────────────────────────────────────────────────────────────
export type Tempo = "slow" | "medium" | "fast";
export const TEMPOS: { id: Tempo; label: string; hint: string }[] = [
  { id: "slow", label: "Slow", hint: "under 80" },
  { id: "medium", label: "Medium", hint: "80–120" },
  { id: "fast", label: "Fast", hint: "over 120" },
];
const inTempo = (bpm: number, t: Tempo) => (t === "slow" ? bpm < 80 : t === "fast" ? bpm > 120 : bpm >= 80 && bpm <= 120);

export interface Filters {
  keys: string[]; // canonical keys
  tempos: Tempo[];
  bpmMin: number | null; // custom range (used instead of tempos)
  bpmMax: number | null;
  times: string[];
  feels: string[];
  tags: string[];
}
export const NO_FILTERS: Filters = { keys: [], tempos: [], bpmMin: null, bpmMax: null, times: [], feels: [], tags: [] };

export const countFilters = (f: Filters) =>
  f.keys.length + f.tempos.length + (f.bpmMin !== null || f.bpmMax !== null ? 1 : 0) + f.times.length + f.feels.length + f.tags.length;

/** Any value within a group matches (G or A); every active group must match. Unset groups ignore missing data. */
export function matches(d: SongDoc, f: Filters): boolean {
  if (f.keys.length) {
    const k = canonKey(d.key);
    if (!k || !f.keys.includes(k)) return false;
  }
  if (f.tempos.length || f.bpmMin !== null || f.bpmMax !== null) {
    if (d.bpm === null) return false;
    if (f.tempos.length && !f.tempos.some((t) => inTempo(d.bpm!, t))) return false;
    if (f.bpmMin !== null && d.bpm < f.bpmMin) return false;
    if (f.bpmMax !== null && d.bpm > f.bpmMax) return false;
  }
  if (f.times.length && (!d.time || !f.times.includes(d.time))) return false;
  if (f.feels.length && (!d.feel || !f.feels.includes(d.feel.toLowerCase()))) return false;
  if (f.tags.length && !d.tags.some((t) => f.tags.includes(t.toLowerCase()))) return false;
  return true;
}

// ── sorting ─────────────────────────────────────────────────────────────────
export type Sort = "best" | "title" | "artist" | "key" | "bpm" | "bpm-desc" | "recent";
export const SORTS: { id: Sort; label: string }[] = [
  { id: "best", label: "Best match" },
  { id: "title", label: "Title A–Z" },
  { id: "artist", label: "Artist A–Z" },
  { id: "key", label: "Key" },
  { id: "bpm", label: "BPM slow → fast" },
  { id: "bpm-desc", label: "BPM fast → slow" },
  { id: "recent", label: "Recently viewed" },
];

const coll = new Intl.Collator("en", { sensitivity: "base", numeric: true });
const byTitle = (a: SongDoc, b: SongDoc) => coll.compare(a.title, b.title) || coll.compare(a.artist ?? "", b.artist ?? "");
const missingLast = (a: number | null, b: number | null) => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : a - b);

/** `recent` maps slug -> last viewed time. "best" keeps the given (relevance) order when searching, else A–Z. */
export function sortDocs(docs: SongDoc[], sort: Sort, searching: boolean, recent: Map<string, number>): SongDoc[] {
  if (sort === "best" && searching) return docs;
  const out = [...docs];
  const cmp: Record<Sort, (a: SongDoc, b: SongDoc) => number> = {
    best: byTitle,
    title: byTitle,
    artist: (a, b) =>
      (a.artist ? (b.artist ? coll.compare(a.artist, b.artist) : -1) : b.artist ? 1 : 0) || byTitle(a, b),
    key: (a, b) => keyOrder(a.key) - keyOrder(b.key) || byTitle(a, b),
    bpm: (a, b) => missingLast(a.bpm, b.bpm) || byTitle(a, b),
    "bpm-desc": (a, b) => missingLast(a.bpm === null ? null : -a.bpm, b.bpm === null ? null : -b.bpm) || byTitle(a, b),
    recent: (a, b) => (recent.get(b.slug) ?? 0) - (recent.get(a.slug) ?? 0) || byTitle(a, b),
  };
  return out.sort(cmp[sort]);
}

/** First letter for the A–Z jump strip ("#" for digits/symbols). */
export function letterOf(s: string | null): string {
  const c = (s ?? "").normalize("NFD").charAt(0).toUpperCase();
  return c >= "A" && c <= "Z" ? c : "#";
}

// ── facets (built from the data, never hard-coded) ─────────────────────────
export interface Facets {
  keys: { value: string; count: number }[];
  tempos: { value: Tempo; count: number }[];
  times: { value: string; count: number }[];
  feels: { value: string; count: number }[];
  tags: { value: string; count: number }[];
}

function counted(values: (string | null)[]) {
  const m = new Map<string, number>();
  for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].map(([value, count]) => ({ value, count }));
}
const byCount = (a: { value: string; count: number }, b: { value: string; count: number }) =>
  b.count - a.count || coll.compare(a.value, b.value);

export function facets(docs: SongDoc[]): Facets {
  return {
    keys: counted(docs.map((d) => canonKey(d.key))).sort((a, b) => keyOrder(a.value) - keyOrder(b.value)),
    tempos: TEMPOS.map((t) => ({ value: t.id, count: docs.filter((d) => d.bpm !== null && inTempo(d.bpm, t.id)).length })).filter(
      (t) => t.count > 0,
    ),
    times: counted(docs.map((d) => d.time)).sort(byCount),
    feels: counted(docs.map((d) => d.feel?.toLowerCase() ?? null)).sort(byCount),
    tags: counted(docs.flatMap((d) => d.tags.map((t) => t.toLowerCase()))).sort(byCount),
  };
}

// ── URL / saved state ───────────────────────────────────────────────────────
export type View = "recent" | "az" | "artists";
export interface BrowseState {
  q: string;
  view: View | null; // null = pick (recent if any, else A–Z)
  artist: string | null;
  sort: Sort;
  f: Filters;
}
export const EMPTY_STATE: BrowseState = { q: "", view: null, artist: null, sort: "best", f: NO_FILTERS };

const num = (s: string | undefined) => (s && /^\d{1,3}$/.test(s) ? Number(s) : null);
const uniq = (a: string[]) => [...new Set(a)];

export function parseState(qs: string): BrowseState {
  const p = new URLSearchParams(qs);
  const all = (k: string) => uniq(p.getAll(k).map((v) => v.trim()).filter(Boolean));
  const [lo, hi] = (p.get("bpm") ?? "").split("-");
  const view = p.get("view");
  const sort = p.get("sort");
  return {
    q: p.get("q") ?? "",
    view: view === "recent" || view === "az" || view === "artists" ? view : null,
    artist: p.get("artist") || null,
    sort: SORTS.some((s) => s.id === sort) ? (sort as Sort) : "best",
    f: {
      keys: uniq(all("key").map(canonKey).filter((k): k is string => !!k)),
      tempos: all("tempo").filter((t): t is Tempo => t === "slow" || t === "medium" || t === "fast"),
      bpmMin: num(lo),
      bpmMax: num(hi),
      times: all("time"),
      feels: all("feel").map((v) => v.toLowerCase()),
      tags: all("tag").map((v) => v.toLowerCase()),
    },
  };
}

/** Filters + sort only (what a device remembers). */
export function prefsQuery(s: Pick<BrowseState, "sort" | "f">): URLSearchParams {
  const p = new URLSearchParams();
  s.f.keys.forEach((v) => p.append("key", v));
  s.f.tempos.forEach((v) => p.append("tempo", v));
  if (s.f.bpmMin !== null || s.f.bpmMax !== null) p.set("bpm", `${s.f.bpmMin ?? ""}-${s.f.bpmMax ?? ""}`);
  s.f.times.forEach((v) => p.append("time", v));
  s.f.feels.forEach((v) => p.append("feel", v));
  s.f.tags.forEach((v) => p.append("tag", v));
  if (s.sort !== "best") p.set("sort", s.sort);
  return p;
}

export function stateQuery(s: BrowseState): string {
  const p = new URLSearchParams();
  if (s.q) p.set("q", s.q);
  if (s.view) p.set("view", s.view);
  if (s.artist) p.set("artist", s.artist);
  for (const [k, v] of prefsQuery(s)) p.append(k, v);
  return p.toString();
}

/** True when the URL carries any filter or sort (then it wins over what the device remembered). */
export const hasPrefs = (s: BrowseState) => s.sort !== "best" || countFilters(s.f) > 0;
