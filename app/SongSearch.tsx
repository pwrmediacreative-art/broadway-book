"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import {
  countFilters,
  EMPTY_STATE,
  facets,
  hasPrefs,
  letterOf,
  matches,
  NO_FILTERS,
  parseState,
  prefsQuery,
  SORTS,
  sortDocs,
  stateQuery,
  TEMPOS,
  type BrowseState,
  type Filters,
  type Sort,
  type View,
} from "@/lib/search/browse";
import { createEngine } from "@/lib/search/engine";
import type { SongDoc } from "@/lib/search/pack";
import { useRecent } from "@/lib/search/recent";
import { useSongIndex } from "@/lib/search/useIndex";
import { PREF, readPref, setPref } from "@/lib/prefs";
import FilterSheet, { cap, Chip } from "./FilterSheet";
import SongRow from "./SongRow";

const SAVED = "bb.browse"; // filters + sort this device used last
const RECENT_SHOWN = 20;
const PAGE = 60;

type Row =
  | { kind: "song"; d: SongDoc }
  | { kind: "artist"; name: string; count: number };

export default function SongSearch() {
  const index = useSongIndex();
  const docs = index.docs;
  const recent = useRecent();
  const [st, setSt] = useState<BrowseState>(EMPTY_STATE);
  const [ready, setReady] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const input = useRef<HTMLInputElement>(null);
  const more = useRef<HTMLDivElement>(null);

  // Start from the URL; if it has no filters/sort, use what this device remembered.
  useEffect(() => {
    const s = parseState(window.location.search);
    const saved = parseState(readPref(SAVED) ?? "");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of browser-only state
    setSt(hasPrefs(s) ? s : { ...s, sort: saved.sort, f: saved.f });
    setReady(true);
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches)
      input.current?.focus();
  }, []);

  // Keep the URL shareable and remember filters + sort.
  useEffect(() => {
    if (!ready) return;
    const qs = stateQuery(st);
    window.history.replaceState(
      window.history.state,
      "",
      qs ? `?${qs}` : window.location.pathname,
    );
    setPref(SAVED, prefsQuery(st).toString() || null);
  }, [st, ready]);

  // "/" focuses the search box on a keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const engine = useMemo(() => (docs ? createEngine(docs) : null), [docs]);
  const fx = useMemo(() => facets(docs ?? []), [docs]);
  const bySlug = useMemo(
    () => new Map((docs ?? []).map((d) => [d.slug, d])),
    [docs],
  );

  const q = useDeferredValue(st.q);
  const searching = q.trim().length > 0;
  const view: View = st.view ?? (recent.size ? "recent" : "az");
  const mode = searching ? "results" : view;

  const { rows, songs, hidden } = useMemo(() => {
    let base: SongDoc[];
    if (searching)
      base = (engine?.search(q) ?? [])
        .map((s) => bySlug.get(s)!)
        .filter(Boolean);
    else if (view === "recent")
      base = [...recent.keys()]
        .map((s) => bySlug.get(s))
        .filter((d): d is SongDoc => !!d)
        .slice(0, RECENT_SHOWN);
    else if (view === "artists" && st.artist)
      base = (docs ?? []).filter((d) => d.artist === st.artist);
    else base = docs ?? [];

    const filtered = base.filter((d) => matches(d, st.f));
    const keepOrder = searching || view === "recent";
    const songs = sortDocs(filtered, st.sort, keepOrder, recent);
    let rows: Row[];
    if (!searching && view === "artists" && !st.artist) {
      const counts = new Map<string, number>();
      for (const d of filtered)
        if (d.artist) counts.set(d.artist, (counts.get(d.artist) ?? 0) + 1);
      rows = [...counts]
        .sort((a, b) => a[0].localeCompare(b[0], "en", { sensitivity: "base" }))
        .map(([name, count]) => ({ kind: "artist", name, count }));
    } else rows = songs.map((d) => ({ kind: "song", d }));
    return { rows, songs, hidden: base.length - filtered.length };
  }, [
    searching,
    q,
    engine,
    bySlug,
    view,
    recent,
    docs,
    st.artist,
    st.f,
    st.sort,
  ]);

  // Render a page at a time; grow as the player scrolls.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- new list starts at the first page
  useEffect(() => setLimit(PAGE), [rows]);
  useEffect(() => {
    const el = more.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (e) => e[0].isIntersecting && setLimit((l) => l + 200),
      { rootMargin: "800px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rows, limit]);

  // Next/previous song in the chart follows this list.
  const listRef = useRef(songs);
  useEffect(() => {
    listRef.current = songs;
  }, [songs]);
  const onOpen = useCallback(
    () =>
      setPref(
        PREF.nav,
        JSON.stringify(
          listRef.current.map((r) => ({ slug: r.slug, title: r.title })),
        ),
        "session",
      ),
    [],
  );

  const update = (p: Partial<BrowseState>) => setSt((s) => ({ ...s, ...p }));
  const setF = (f: Filters) => update({ f });
  const nFilters = countFilters(st.f);

  // A–Z jump strip (titles, or artists in the artist list / artist sort).
  const byArtist = st.sort === "artist";
  const showLetters =
    !searching &&
    rows.length > 30 &&
    (view === "artists" ? !st.artist : view === "az") &&
    ["best", "title", "artist"].includes(st.sort);
  const letterKeys = useMemo(
    () =>
      rows.map((r) =>
        letterOf(
          r.kind === "artist" ? r.name : byArtist ? r.d.artist : r.d.title,
        ),
      ),
    [rows, byArtist],
  );
  const letters = useMemo(
    () => (showLetters ? [...new Set(letterKeys)] : []),
    [letterKeys, showLetters],
  );
  const jump = (letter: string) => {
    const i = letterKeys.indexOf(letter);
    if (i < 0) return;
    if (i >= limit) flushSync(() => setLimit(i + PAGE));
    document.getElementById(`r${i}`)?.scrollIntoView({ block: "start" });
  };

  // Chips: active filters first (tap to remove), then suggestions from the data.
  const active: { label: string; off: Filters }[] = [
    ...(st.f.verified ? [{ label: "Verified only", off: { ...st.f, verified: false } }] : []),
    ...st.f.keys.map((v) => ({
      label: `Key ${v}`,
      off: { ...st.f, keys: st.f.keys.filter((x) => x !== v) },
    })),
    ...st.f.tempos.map((v) => ({
      label: cap(v),
      off: { ...st.f, tempos: st.f.tempos.filter((x) => x !== v) },
    })),
    ...(st.f.bpmMin !== null || st.f.bpmMax !== null
      ? [
          {
            label: `${st.f.bpmMin ?? "…"}–${st.f.bpmMax ?? "…"} bpm`,
            off: { ...st.f, bpmMin: null, bpmMax: null },
          },
        ]
      : []),
    ...st.f.times.map((v) => ({
      label: v,
      off: { ...st.f, times: st.f.times.filter((x) => x !== v) },
    })),
    ...st.f.feels.map((v) => ({
      label: cap(v),
      off: { ...st.f, feels: st.f.feels.filter((x) => x !== v) },
    })),
    ...st.f.tags.map((v) => ({
      label: v,
      off: { ...st.f, tags: st.f.tags.filter((x) => x !== v) },
    })),
  ];
  const custom = st.f.bpmMin !== null || st.f.bpmMax !== null;
  const suggestions: { label: string; on: Filters }[] = [
    ...(custom
      ? []
      : fx.tempos.filter((t) => !st.f.tempos.includes(t.value))
    ).map((t) => ({
      label: TEMPOS.find((x) => x.id === t.value)!.label,
      on: { ...st.f, tempos: [...st.f.tempos, t.value] },
    })),
    ...fx.feels
      .filter((x) => !st.f.feels.includes(x.value))
      .slice(0, 4)
      .map((x) => ({
        label: cap(x.value),
        on: { ...st.f, feels: [...st.f.feels, x.value] },
      })),
    ...fx.tags
      .filter((x) => !st.f.tags.includes(x.value))
      .slice(0, 6)
      .map((x) => ({
        label: x.value,
        on: { ...st.f, tags: [...st.f.tags, x.value] },
      })),
  ];

  const count = rows.length;
  const noun =
    mode === "artists" && !st.artist
      ? count === 1
        ? "artist"
        : "artists"
      : count === 1
        ? "song"
        : "songs";

  return (
    <>
      <label htmlFor="search" className="sr-only">
        Search songs
      </label>
      <div className="sticky top-0 z-20 -mx-4 bg-bb-house-black px-4 pb-2 pt-2">
        <div className="relative">
          <input
            ref={input}
            id="search"
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Search title or artist"
            value={st.q}
            onChange={(e) => update({ q: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && input.current?.blur()}
            className="h-14 w-full rounded-xl border border-bb-rule-gray bg-bb-case-charcoal pl-4 pr-14 text-xl text-bb-chart-white placeholder:text-bb-cue-gray focus:border-bb-downbeat-amber focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {st.q && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                update({ q: "" });
                input.current?.focus();
              }}
              className="absolute right-1 top-1 flex h-12 w-12 items-center justify-center text-2xl text-bb-cue-gray active:text-bb-chart-white"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {!searching && (
        <div
          role="tablist"
          aria-label="Browse"
          className="mb-3 grid grid-cols-3 gap-1 rounded-xl border border-bb-rule-gray bg-bb-case-charcoal p-1"
        >
          {(
            [
              ["recent", "Recent"],
              ["az", "A–Z"],
              ["artists", "Artists"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={view === id}
              onClick={() => update({ view: id, artist: null })}
              className={`h-12 rounded-lg text-lg font-semibold ${view === id ? "bg-bb-downbeat-amber text-bb-stage-black" : "text-bb-chart-white active:bg-bb-rule-gray"}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setSheet(true)}
          className={`h-12 shrink-0 rounded-xl border px-4 text-lg font-semibold ${
            nFilters
              ? "border-bb-downbeat-amber text-bb-downbeat-amber"
              : "border-bb-rule-gray text-bb-chart-white"
          } active:bg-bb-rule-gray`}
        >
          Filters{nFilters ? ` · ${nFilters}` : ""}
        </button>
        <label className="sr-only" htmlFor="sort">
          Sort
        </label>
        <select
          id="sort"
          value={st.sort}
          onChange={(e) => update({ sort: e.target.value as Sort })}
          className="h-12 min-w-0 flex-1 rounded-xl border border-bb-rule-gray bg-bb-case-charcoal px-3 text-lg text-bb-chart-white focus:border-bb-downbeat-amber focus:outline-none"
        >
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id === "best" && !searching ? "Title A–Z" : s.label}
            </option>
          ))}
        </select>
      </div>

      {(active.length > 0 || suggestions.length > 0) && (
        <div className="-mx-4 mb-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {active.length > 1 && (
            <Chip on={false} onClick={() => setF(NO_FILTERS)}>
              Clear all
            </Chip>
          )}
          {active.map((c) => (
            <Chip
              key={`a-${c.label}`}
              on
              onClick={() => setF(c.off)}
              label={`Remove filter ${c.label}`}
            >
              {c.label} <span aria-hidden>×</span>
            </Chip>
          ))}
          {suggestions.map((c) => (
            <Chip key={`s-${c.label}`} on={false} onClick={() => setF(c.on)}>
              {c.label}
            </Chip>
          ))}
        </div>
      )}

      <p className="mb-2 text-sm text-bb-cue-gray" aria-live="polite">
        {docs ? `${count} ${noun}` : ""}
        {docs && hidden > 0 && count > 0 && (
          <>
            {" · "}
            <button
              type="button"
              onClick={() => setF(NO_FILTERS)}
              className="text-bb-downbeat-amber underline"
            >
              {hidden} hidden by filters
            </button>
          </>
        )}
        {index.offline && docs && " · offline, showing saved songs"}
      </p>
      {rows.some((r) => r.kind === "song" && r.d.uv) && (
        <p className="-mt-1 mb-2 flex items-center gap-2 text-sm text-bb-cue-gray" data-uv-legend>
          <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-amber-400" />
          Not yet checked against the original
        </p>
      )}

      {mode === "artists" && st.artist && (
        <div className="mb-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => update({ artist: null })}
            className="h-12 pr-3 text-lg text-bb-cue-gray active:text-bb-chart-white"
          >
            ← All artists
          </button>
          <h2 className="truncate text-xl font-bold">{st.artist}</h2>
        </div>
      )}

      {!docs ? (
        <p className="rounded-xl border border-bb-rule-gray bg-bb-case-charcoal px-4 py-6 text-center text-bb-cue-gray">
          {index.offline
            ? "Can’t reach the song list. Check your connection and reload."
            : "Loading songs…"}
        </p>
      ) : count === 0 ? (
        <Empty
          hidden={hidden}
          searching={searching}
          q={q}
          view={view}
          clear={() => setF(NO_FILTERS)}
          browse={() => update({ view: "az" })}
        />
      ) : (
        <div className="flex items-start gap-1">
          <ul className="min-w-0 flex-1 divide-y divide-bb-rule-gray overflow-hidden rounded-xl border border-bb-rule-gray">
            {rows.slice(0, limit).map((r, i) =>
              r.kind === "song" ? (
                <SongRow key={r.d.slug} d={r.d} index={i} onOpen={onOpen} />
              ) : (
                <li key={r.name} id={`r${i}`} className="scroll-mt-20">
                  <button
                    type="button"
                    onClick={() => {
                      update({ artist: r.name });
                      window.scrollTo({ top: 0 });
                    }}
                    className="flex min-h-14 w-full items-center justify-between gap-3 bg-bb-case-charcoal px-4 py-3 text-left active:bg-bb-rule-gray"
                  >
                    <span className="truncate text-xl font-semibold">
                      {r.name}
                    </span>
                    <span className="shrink-0 text-bb-cue-gray">{r.count}</span>
                  </button>
                </li>
              ),
            )}
          </ul>
          {letters.length > 1 && (
            <LetterStrip letters={letters} onJump={jump} />
          )}
        </div>
      )}
      {limit < count && <div ref={more} className="h-24" aria-hidden />}

      <FilterSheet
        open={sheet}
        onClose={() => setSheet(false)}
        f={st.f}
        setF={setF}
        fx={fx}
        count={count}
      />
    </>
  );
}

function Empty({
  hidden,
  searching,
  q,
  view,
  clear,
  browse,
}: {
  hidden: number;
  searching: boolean;
  q: string;
  view: View;
  clear: () => void;
  browse: () => void;
}) {
  const box = "rounded-xl border border-bb-rule-gray bg-bb-case-charcoal px-4 py-6 text-center";
  if (hidden > 0)
    return (
      <div className={box}>
        <p className="mb-3 text-lg">
          No songs match these filters. {hidden}{" "}
          {hidden === 1 ? "song is" : "songs are"} hidden.
        </p>
        <button
          type="button"
          onClick={clear}
          className="h-12 rounded-xl bg-bb-downbeat-amber px-6 text-lg font-bold text-bb-stage-black active:opacity-80"
        >
          Clear filters
        </button>
      </div>
    );
  if (searching)
    return <p className={`${box} text-bb-cue-gray`}>No songs match “{q.trim()}”.</p>;
  if (view === "recent")
    return (
      <div className={box}>
        <p className="mb-3 text-bb-cue-gray">Songs you open show up here.</p>
        <button
          type="button"
          onClick={browse}
          className="h-12 rounded-xl border border-bb-rule-gray px-6 text-lg font-semibold active:bg-bb-rule-gray"
        >
          Browse A–Z
        </button>
      </div>
    );
  return <p className={`${box} text-bb-cue-gray`}>No songs yet.</p>;
}

/** Thin A–Z strip on the right edge; tap or drag a thumb along it to jump. */
function LetterStrip({
  letters,
  onJump,
}: {
  letters: string[];
  onJump: (l: string) => void;
}) {
  const last = useRef("");
  const at = (x: number, y: number) => {
    const l = (document.elementFromPoint(x, y) as HTMLElement | null)?.dataset
      .letter;
    if (l && l !== last.current) {
      last.current = l;
      onJump(l);
    }
  };
  return (
    <nav
      aria-label="Jump to letter"
      className="sticky top-[4.75rem] flex h-[calc(100dvh-6rem)] max-h-[48rem] w-8 shrink-0 touch-none select-none flex-col items-center justify-around rounded-xl border border-bb-rule-gray bg-bb-case-charcoal py-1"
      onPointerDown={(e) => {
        last.current = "";
        (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
        at(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => e.buttons && at(e.clientX, e.clientY)}
    >
      {letters.map((l) => (
        <button
          key={l}
          type="button"
          data-letter={l}
          onClick={() => onJump(l)}
          aria-label={`Jump to ${l}`}
          className="w-8 text-center text-sm font-bold text-bb-downbeat-amber"
        >
          {l}
        </button>
      ))}
    </nav>
  );
}
