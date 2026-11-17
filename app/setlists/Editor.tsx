"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { pretty } from "@/lib/chart";
import { createEngine } from "@/lib/search/engine";
import { useSongIndex } from "@/lib/search/useIndex";
import { loadSongs } from "@/lib/setlists/api";
import { keyOptions, MAX_NOTE, MAX_SONGS, noteCheck, placeOf, type PlaySet, type SetItem } from "@/lib/setlists/play";
import { btn, DupConfirm, enterFullscreen, plain, primary } from "./ui";

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
  note,
}: {
  initial: PlaySet;
  save: (s: PlaySet) => Promise<void>;
  playHref: string;
  share: ReactNode | ((current: PlaySet) => ReactNode);
  danger: ReactNode;
  note?: ReactNode; // shown above Play (e.g. "Copied from Pat on Nov 16")
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
  // Remove with Undo: the row comes back in the same place.
  const [undo, setUndo] = useState<{ row: Row; index: number } | null>(null);
  const remove = (u: string) => {
    const index = rows.findIndex((r) => r.uid === u);
    if (index < 0) return;
    setUndo({ row: rows[index], index });
    setRows((rs) => rs.filter((r) => r.uid !== u));
  };
  const undoRemove = () => {
    if (!undo) return;
    setRows((rs) => (rs.length >= MAX_SONGS ? rs : [...rs.slice(0, undo.index), undo.row, ...rs.slice(undo.index)]));
    setUndo(null);
  };
  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo(null), 8000);
    return () => window.clearTimeout(t);
  }, [undo]);
  const [editing, setEditing] = useState<string | null>(null);
  // Open the set at this song: setlist key and note, next/previous in setlist order.
  const opening = useRef(false);
  const openAt = async (i: number, stage: boolean) => {
    if (opening.current) return; // a double tap opens once
    opening.current = true;
    if (stage) enterFullscreen();
    await flush();
    router.push(`${playHref}?at=${i}`);
  };

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
  const [dup, setDup] = useState<{ slug: string; title: string; n: number } | null>(null);
  const cancelDup = () => setDup(null);
  const results = useMemo(() => (engine?.search(q) ?? []).slice(0, 8).map((s) => bySlug.get(s)!).filter(Boolean), [engine, q, bySlug]);
  const full = rows.length >= MAX_SONGS;
  const add = async (slug: string, title: string, again = false) => {
    if (full) return;
    const n = again ? null : placeOf(rows.map((r) => r.slug), slug);
    if (n !== null) return setDup({ slug, title, n });
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
        <Link href="/setlists" className="inline-flex h-12 items-center text-lg text-bb-cue-gray active:text-bb-chart-white">
          ← Setlists
        </Link>
        <span className={`text-base ${status === "error" ? "text-bb-stop-red" : "text-bb-cue-gray"}`} aria-live="polite">
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
        className="bb-input mb-2 h-14 w-full bg-bb-case-charcoal px-3 text-2xl font-bold"
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label htmlFor="sl-date" className="text-lg text-bb-cue-gray">
          Date
        </label>
        <input
          id="sl-date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="bb-input h-12 bg-bb-case-charcoal px-3 font-bb-data text-lg [color-scheme:dark]"
        />
        {date && (
          <button className={`${btn} ${plain} text-base`} onClick={() => setDate("")}>
            Clear date
          </button>
        )}
      </div>

      {err && <p className="bb-error mb-3 border border-bb-stop-red p-3 text-lg">{err}</p>}
      {note}

      <button onClick={play} disabled={!playable} className={`${btn} ${primary} mb-4 h-14 w-full text-xl`}>
        Play set ▸ {playable ? `(${playable} song${playable === 1 ? "" : "s"})` : ""}
      </button>

      {rows.length === 0 && <p className="mb-4 text-lg text-bb-cue-gray">No songs yet. Search below to add some.</p>}
      <ol ref={list} className="mb-4 flex flex-col divide-y divide-bb-rule-gray border-y border-bb-rule-gray">
        {rows.map((r, i) => (
          <SongEditRow
            key={r.uid}
            r={r}
            n={i + 1}
            dragging={dragging === r.uid}
            onHandle={(e) => startDrag(e, r.uid)}
            onOpen={() => void openAt(i, false)}
            onEdit={() => setEditing(r.uid)}
          />
        ))}
      </ol>
      {undo && (
        <div className="fixed inset-x-0 bottom-[var(--bb-tabs-bottom,0px)] z-[60] flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]" aria-live="polite">
          <div className="bb-panel flex w-full max-w-md items-center gap-3 border border-bb-rule-gray px-4 py-2">
            <span className="min-w-0 flex-1 truncate text-lg">Removed {undo.row.song?.title ?? "song"}</span>
            <button onClick={undoRemove} className={`${btn} ${primary} shrink-0`}>
              Undo
            </button>
          </div>
        </div>
      )}
      {(() => {
        const i = rows.findIndex((r) => r.uid === editing);
        if (i < 0) return null;
        const r = rows[i];
        return (
          <EditSheet
            key={r.uid}
            r={r}
            n={i + 1}
            last={i === rows.length - 1}
            onPatch={(p) => patch(r.uid, p)}
            onUp={() => move(i, i - 1)}
            onDown={() => move(i, i + 1)}
            onStage={() => {
              setEditing(null);
              void openAt(i, true);
            }}
            onRemove={() => {
              setEditing(null);
              remove(r.uid);
            }}
            onClose={() => setEditing(null)}
          />
        );
      })()}

      <section className="mb-6 border border-bb-rule-gray p-3">
        <label htmlFor="sl-add" className="mb-2 block text-lg font-semibold">
          Add songs {full && <span className="font-normal text-bb-cue-gray">· full ({MAX_SONGS} songs)</span>}
        </label>
        <input
          id="sl-add"
          type="search"
          value={q}
          disabled={full}
          onChange={(e) => setQ(e.target.value)}
          placeholder={docs ? "Search title or artist" : "Loading songs…"}
          autoComplete="off"
          className="bb-input h-12 w-full bg-bb-case-charcoal px-3 text-lg"
        />
        {added && (
          <p className="mt-2 text-lg text-bb-chart-white" aria-live="polite">
            ✓ Added {added}
          </p>
        )}
        {results.length > 0 && (
          <ul className="mt-2 divide-y divide-bb-rule-gray border-y border-bb-rule-gray">
            {results.map((d) => (
              <li key={d.slug}>
                <button
                  disabled={!!adding || full}
                  onClick={() => add(d.slug, d.title)}
                  className="flex min-h-14 w-full items-center gap-3 bg-bb-case-charcoal px-3 py-2 text-left active:bg-bb-rule-gray"
                >
                  <span className="text-2xl text-bb-chart-white">+</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-lg font-semibold">{d.title}</span>
                    {d.artist && <span className="block truncate text-bb-cue-gray">{d.artist}</span>}
                  </span>
                  {d.key && <span className="font-bb-data text-xl font-bold text-bb-chart-white">{pretty(d.key)}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {dup && (
        <div className="fixed inset-0 z-[70] flex items-end bg-bb-stage-black/80 sm:items-center sm:justify-center" onClick={cancelDup}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded-bb-none border-t border-bb-rule-gray bg-bb-house-black p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-md sm:border"
          >
            <DupConfirm
              title={dup.title}
              n={dup.n}
              onCancel={cancelDup}
              onAdd={() => {
                setDup(null);
                void add(dup.slug, dup.title, true);
              }}
            />
          </div>
        </div>
      )}

      {typeof share === "function" ? share({ name, gig_date: date || null, items: strip(rows) }) : share}
      {danger}
    </main>
  );
}

function SongEditRow({
  r,
  n,
  dragging,
  onHandle,
  onOpen,
  onEdit,
}: {
  r: Row;
  n: number;
  dragging: boolean;
  onHandle: (e: React.PointerEvent) => void;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const opts = useMemo(() => (r.song ? keyOptions(r.song.chart_text) : []), [r.song]);
  const orig = opts.find((o) => o.orig)?.value ?? null;
  const changedKey = r.key && r.key !== orig ? opts.find((o) => o.value === r.key)?.label ?? r.key : null;
  const title = r.song?.title ?? (r.hidden ? "Private song, not shared" : "Not available");
  return (
    <li className={`bg-bb-case-charcoal p-2 ${dragging ? "outline outline-1 -outline-offset-1 outline-bb-downbeat-amber" : ""}`}>
      <div className="flex items-center gap-2">
        <button
          onPointerDown={onHandle}
          aria-label={`Drag to reorder ${r.song?.title ?? "song"}`}
          className="grid h-12 w-10 shrink-0 cursor-grab touch-none place-items-center rounded-bb-control text-2xl text-bb-cue-gray active:bg-bb-rule-gray"
        >
          ≡
        </button>
        <span className="w-7 shrink-0 text-right font-bb-data text-lg tabular-nums text-bb-cue-gray">{n}</span>
        {r.song ? (
          <button onClick={onOpen} className="flex min-h-12 min-w-0 flex-1 flex-col justify-center text-left active:text-bb-downbeat-amber" aria-label={[`Open ${title}`, r.song.artist, changedKey ? `key ${pretty(changedKey)}` : null, r.note ? `note: ${r.note}` : null].filter(Boolean).join(", ")}>
            <span className="block truncate text-xl font-semibold">{title}</span>
            <span className="block truncate text-sm text-bb-cue-gray">
              {[r.song.artist, changedKey ? `Key: ${pretty(changedKey)}` : null].filter(Boolean).join(" · ")}
            </span>
            {r.note && <span className="block truncate text-base text-bb-chart-white">“{r.note}”</span>}
          </button>
        ) : (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xl font-semibold text-bb-cue-gray line-through">{title}</span>
            {r.note && <span className="block truncate text-base text-bb-chart-white">“{r.note}”</span>}
          </span>
        )}
        {changedKey && (
          <span className="shrink-0 border border-bb-downbeat-amber px-2 py-1 font-bb-data text-base font-bold text-bb-downbeat-amber" aria-hidden>
            {pretty(changedKey)}
          </span>
        )}
        <button onClick={onEdit} aria-label={`Edit ${title} in this setlist`} className={`bb-btn size-12 shrink-0 p-0 text-2xl ${plain}`}>
          ⋯
        </button>
      </div>
    </li>
  );
}

/** One song's options in this setlist: note, key, order, stage, remove. Changes save as you go. */
function EditSheet({
  r,
  n,
  last,
  onPatch,
  onUp,
  onDown,
  onStage,
  onRemove,
  onClose,
}: {
  r: Row;
  n: number;
  last: boolean;
  onPatch: (p: Partial<SetItem>) => void;
  onUp: () => void;
  onDown: () => void;
  onStage: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const opts = useMemo(() => (r.song ? keyOptions(r.song.chart_text) : []), [r.song]);
  const orig = opts.find((o) => o.orig)?.value ?? null;
  const [note, setNote] = useState(r.note ?? "");
  const [asking, setAsking] = useState(false);
  const check = noteCheck(note);
  const title = r.song?.title ?? (r.hidden ? "Private song, not shared" : "Not available");
  const saveNote = () => {
    if (!check.error) onPatch({ note: note.trim() || null });
  };
  const close = () => {
    saveNote();
    onClose();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      if (asking) setAsking(false);
      else close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  const item = `${btn} ${plain} h-12 w-full justify-start text-left`;
  return (
    <div className="fixed inset-0 z-[70] flex items-end bg-bb-stage-black/80 sm:items-center sm:justify-center" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${title}`}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90dvh] w-full overflow-y-auto border-t border-bb-rule-gray bg-bb-house-black p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-md sm:border"
      >
        <div className="mb-3 flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-xl font-bold">
            {n}. {title}
          </h2>
          <button onClick={close} aria-label="Done" className="bb-btn bb-btn-quiet size-11 p-0 text-2xl text-bb-cue-gray">
            ✕
          </button>
        </div>
        {asking ? (
          <div role="alertdialog" aria-label={`Remove ${title}?`}>
            <p className="mb-4 text-xl">Remove “{title}” from this setlist?</p>
            <div className="flex gap-2">
              <button autoFocus onClick={() => setAsking(false)} className={`${btn} ${primary} h-14 flex-1`}>
                Cancel
              </button>
              <button onClick={onRemove} className={`${btn} bb-btn-danger h-14 flex-1`}>
                Remove
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-base text-bb-cue-gray">
              Note for this song in this setlist
              <input
                value={note}
                maxLength={MAX_NOTE}
                onChange={(e) => setNote(e.target.value)}
                onBlur={saveNote}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                placeholder="e.g. start on the chorus"
                className="bb-input h-12 px-3 text-lg text-bb-chart-white"
              />
              {(check.warning || check.error) && <span className={`text-sm ${check.error ? "text-bb-stop-red" : "text-bb-chart-white"}`}>{check.error ?? check.warning}</span>}
            </label>
            {opts.length > 0 && (
              <label className="flex flex-col gap-1 text-base text-bb-cue-gray">
                Key in this setlist (the chart itself doesn’t change)
                <select
                  value={r.key && r.key !== orig ? r.key : (orig ?? "")}
                  onChange={(e) => onPatch({ key: e.target.value === orig ? null : e.target.value })}
                  className={`bb-input h-12 px-2 font-bb-data text-lg font-bold ${r.key && r.key !== orig ? "border-bb-downbeat-amber bg-bb-downbeat-amber text-bb-stage-black" : "text-bb-chart-white"}`}
                >
                  {opts.map((o) => (
                    <option key={o.value} value={o.value}>
                      {pretty(o.label)}
                      {o.orig ? " orig" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={onUp} disabled={n === 1} className={`${btn} ${plain} h-12`}>
                ↑ Move up
              </button>
              <button onClick={onDown} disabled={last} className={`${btn} ${plain} h-12`}>
                ↓ Move down
              </button>
            </div>
            {r.song && (
              <button onClick={onStage} className={item}>
                ▸ Open in stage mode from this song
              </button>
            )}
            <button onClick={() => setAsking(true)} className={`${btn} bb-btn-danger h-12 w-full`}>
              Remove from setlist
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
