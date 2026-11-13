"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { pretty } from "@/lib/chart";
import { createEngine } from "@/lib/search/engine";
import { useSongIndex } from "@/lib/search/useIndex";
import { loadSongs } from "@/lib/setlists/api";
import { keyOptions, MAX_NOTE, MAX_SONGS, noteCheck, type PlaySet, type SetItem } from "@/lib/setlists/play";
import { btn, enterFullscreen, plain, primary } from "./ui";

type Row = SetItem & { uid: string };
let uidN = 0;
const uid = () => `r${++uidN}`;
const SAVE_MS = 600;
const strip = (rs: Row[]): SetItem[] => rs.map(({ song_id, slug, key, note, song }) => ({ song_id, slug, key, note, song }));

/** Setlist editor shared by account and device setlists. Saves automatically. */
export default function Editor({
  initial,
  save,
  playHref,
  share,
  danger,
}: {
  initial: PlaySet;
  save: (s: PlaySet) => Promise<void>;
  playHref: string;
  share: ReactNode | ((current: PlaySet) => ReactNode);
  danger: ReactNode;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [date, setDate] = useState(initial.gig_date ?? "");
  const [rows, setRows] = useState<Row[]>(() => initial.items.map((it) => ({ ...it, uid: uid() })));
  const [status, setStatus] = useState<"saved" | "pending" | "saving" | "error">("saved");
  const [err, setErr] = useState<string | null>(null);

  // --- autosave ------------------------------------------------------------------------------
  const latest = useRef<PlaySet>({ name, gig_date: date || null, items: strip(rows) });
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    if (!dirty.current) return chain.current;
    dirty.current = false;
    const snap = latest.current;
    setStatus("saving");
    chain.current = chain.current
      .then(() => save(snap))
      .then(
        () => {
          if (!dirty.current) setStatus("saved");
          setErr(null);
        },
        (e: Error) => {
          dirty.current = true;
          setStatus("error");
          setErr(e.message);
        },
      );
    return chain.current;
  }, [save]);
  const first = useRef(true);
  useEffect(() => {
    latest.current = { name, gig_date: date || null, items: strip(rows) };
    if (first.current) {
      first.current = false;
      return;
    }
    dirty.current = true;
    setStatus("pending");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), SAVE_MS);
  }, [name, date, rows, flush]);
  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && void flush();
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      void flush();
    };
  }, [flush]);

  const play = async () => {
    enterFullscreen();
    await flush();
    router.push(playHref);
  };

  // --- editing -------------------------------------------------------------------------------
  const patch = (u: string, p: Partial<SetItem>) => setRows((rs) => rs.map((r) => (r.uid === u ? { ...r, ...p } : r)));
  const move = (from: number, to: number) =>
    setRows((rs) => {
      if (to < 0 || to >= rs.length || from === to) return rs;
      const next = [...rs];
      const [r] = next.splice(from, 1);
      next.splice(to, 0, r);
      return next;
    });
  const remove = (u: string) => setRows((rs) => rs.filter((r) => r.uid !== u));

  // --- drag to reorder (handle only; works with touch, mouse and pen) ---------------------------
  const list = useRef<HTMLOListElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const startDrag = (e: React.PointerEvent, u: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setDragging(u);
    navigator.vibrate?.(10);
    const onMove = (ev: PointerEvent) => {
      ev.preventDefault();
      const el = list.current;
      if (!el) return;
      if (ev.clientY < 90) window.scrollBy(0, -14);
      else if (ev.clientY > window.innerHeight - 90) window.scrollBy(0, 14);
      const lis = [...el.children] as HTMLElement[];
      let to = lis.findIndex((li) => {
        const r = li.getBoundingClientRect();
        return ev.clientY < r.top + r.height / 2;
      });
      if (to < 0) to = lis.length - 1;
      setRows((rs) => {
        const from = rs.findIndex((r) => r.uid === u);
        if (from < 0 || from === to) return rs;
        const next = [...rs];
        const [r] = next.splice(from, 1);
        next.splice(to, 0, r);
        return next;
      });
    };
    const end = () => {
      setDragging(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  // --- add songs -----------------------------------------------------------------------------
  const { docs } = useSongIndex();
  const engine = useMemo(() => (docs ? createEngine(docs) : null), [docs]);
  const bySlug = useMemo(() => new Map((docs ?? []).map((d) => [d.slug, d])), [docs]);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const results = useMemo(() => (engine?.search(q) ?? []).slice(0, 8).map((s) => bySlug.get(s)!).filter(Boolean), [engine, q, bySlug]);
  const full = rows.length >= MAX_SONGS;
  const add = async (slug: string, title: string) => {
    if (full) return;
    setAdding(slug);
    try {
      const song = (await loadSongs([slug])).get(slug) ?? null;
      if (!song) throw new Error(`${title} isn't available right now.`);
      setRows((rs) => (rs.length >= MAX_SONGS ? rs : [...rs, { slug, key: null, note: null, song, uid: uid() }]));
      setAdded(title);
      setQ("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setAdding(null);
    }
  };
  useEffect(() => {
    if (!added) return;
    const t = window.setTimeout(() => setAdded(null), 2000);
    return () => window.clearTimeout(t);
  }, [added]);

  const playable = rows.filter((r) => r.song).length;
  const statusText = { saved: "Saved", pending: "Editing…", saving: "Saving…", error: "Not saved" }[status];

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Link href="/setlists" className="inline-flex h-12 items-center text-lg text-muted active:text-foreground">
          ← Setlists
        </Link>
        <span className={`text-base ${status === "error" ? "text-red-400" : "text-muted"}`} aria-live="polite">
          {statusText}
        </span>
      </div>

      <label className="sr-only" htmlFor="sl-name">
        Setlist name
      </label>
      <input
        id="sl-name"
        value={name}
        maxLength={100}
        onChange={(e) => setName(e.target.value)}
        placeholder="Setlist name"
        className="mb-2 h-14 w-full rounded-lg border border-line bg-panel px-3 text-2xl font-bold"
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label htmlFor="sl-date" className="text-lg text-muted">
          Date
        </label>
        <input
          id="sl-date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-12 rounded-lg border border-line bg-panel px-3 text-lg [color-scheme:dark]"
        />
        {date && (
          <button className={`${btn} ${plain} text-base`} onClick={() => setDate("")}>
            Clear date
          </button>
        )}
      </div>

      {err && <p className="mb-3 rounded-lg border border-red-500 p-3 text-lg text-red-300">{err}</p>}

      <button onClick={play} disabled={!playable} className={`${btn} ${primary} mb-4 h-14 w-full text-xl disabled:opacity-40`}>
        Play set ▸ {playable ? `(${playable} song${playable === 1 ? "" : "s"})` : ""}
      </button>

      {rows.length === 0 && <p className="mb-4 text-lg text-muted">No songs yet. Search below to add some.</p>}
      <ol ref={list} className="mb-4 flex flex-col gap-2">
        {rows.map((r, i) => (
          <SongEditRow
            key={r.uid}
            r={r}
            n={i + 1}
            last={i === rows.length - 1}
            dragging={dragging === r.uid}
            onHandle={(e) => startDrag(e, r.uid)}
            onUp={() => move(i, i - 1)}
            onDown={() => move(i, i + 1)}
            onRemove={() => remove(r.uid)}
            onPatch={(p) => patch(r.uid, p)}
          />
        ))}
      </ol>

      <section className="mb-6 rounded-xl border border-line p-3">
        <label htmlFor="sl-add" className="mb-2 block text-lg font-semibold">
          Add songs {full && <span className="font-normal text-muted">· full ({MAX_SONGS} songs)</span>}
        </label>
        <input
          id="sl-add"
          type="search"
          value={q}
          disabled={full}
          onChange={(e) => setQ(e.target.value)}
          placeholder={docs ? "Search title or artist" : "Loading songs…"}
          autoComplete="off"
          className="h-12 w-full rounded-lg border border-line bg-panel px-3 text-lg"
        />
        {added && (
          <p className="mt-2 text-lg text-accent" aria-live="polite">
            Added {added}
          </p>
        )}
        {results.length > 0 && (
          <ul className="mt-2 divide-y divide-line overflow-hidden rounded-lg border border-line">
            {results.map((d) => (
              <li key={d.slug}>
                <button
                  disabled={!!adding || full}
                  onClick={() => add(d.slug, d.title)}
                  className="flex min-h-14 w-full items-center gap-3 bg-panel px-3 py-2 text-left active:bg-line disabled:opacity-50"
                >
                  <span className="text-2xl text-accent">+</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-lg font-semibold">{d.title}</span>
                    {d.artist && <span className="block truncate text-muted">{d.artist}</span>}
                  </span>
                  {d.key && <span className="font-mono text-xl font-bold text-accent">{pretty(d.key)}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {typeof share === "function" ? share({ name, gig_date: date || null, items: strip(rows) }) : share}
      {danger}
    </main>
  );
}

function SongEditRow({
  r,
  n,
  last,
  dragging,
  onHandle,
  onUp,
  onDown,
  onRemove,
  onPatch,
}: {
  r: Row;
  n: number;
  last: boolean;
  dragging: boolean;
  onHandle: (e: React.PointerEvent) => void;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
  onPatch: (p: Partial<SetItem>) => void;
}) {
  const opts = useMemo(() => (r.song ? keyOptions(r.song.chart_text) : []), [r.song]);
  const orig = opts.find((o) => o.orig)?.value ?? null;
  const [note, setNote] = useState(r.note ?? "");
  const check = noteCheck(note);
  const small = `grid size-11 shrink-0 place-items-center rounded-lg ${plain} text-xl disabled:opacity-30`;
  return (
    <li className={`rounded-xl border bg-panel p-2 ${dragging ? "border-accent shadow-2xl" : "border-line"}`}>
      <div className="flex items-center gap-2">
        <button
          onPointerDown={onHandle}
          aria-label={`Drag to reorder ${r.song?.title ?? "song"}`}
          className="grid h-12 w-10 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-2xl text-muted active:bg-line"
        >
          ≡
        </button>
        <span className="w-7 shrink-0 text-right text-lg tabular-nums text-muted">{n}</span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-xl font-semibold ${r.song ? "" : "text-muted line-through"}`}>{r.song?.title ?? "Not available"}</span>
          {r.song?.artist && <span className="block truncate text-sm text-muted">{r.song.artist}</span>}
        </span>
        {opts.length > 0 && (
          <select
            value={r.key && r.key !== orig ? r.key : (orig ?? "")}
            onChange={(e) => onPatch({ key: e.target.value === orig ? null : e.target.value })}
            aria-label={`Key for ${r.song?.title}`}
            className={`h-12 shrink-0 rounded-lg px-2 font-mono text-lg font-bold ${r.key && r.key !== orig ? "bg-accent text-black" : plain}`}
          >
            {opts.map((o) => (
              <option key={o.value} value={o.value}>
                {pretty(o.label)}
                {o.orig ? " orig" : ""}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          value={note}
          maxLength={MAX_NOTE}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => onPatch({ note: note.trim() || null })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          placeholder="Note (e.g. start on the chorus)"
          aria-label={`Note for ${r.song?.title ?? "song"}`}
          className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-background px-3 text-base"
        />
        <button onClick={onUp} disabled={n === 1} aria-label="Move up" className={small}>
          ↑
        </button>
        <button onClick={onDown} disabled={last} aria-label="Move down" className={small}>
          ↓
        </button>
        <button onClick={onRemove} aria-label={`Remove ${r.song?.title ?? "song"}`} className={`${small} text-red-300`}>
          ✕
        </button>
      </div>
      {(check.warning || check.error) && <p className="mt-1 text-sm text-amber-300">{check.error ?? check.warning}</p>}
    </li>
  );
}
