"use client";

// Lyrics per song (Q18, on top of Q7). Each song has a small Lyrics button, shown only when the
// /admin audience includes the player (the server checks again on every request); lyrics stay
// hidden until it's tapped, and the choice is kept per song per player (lib/lyrics/mine.ts).
// The lines sit under the chart's bar rows (lib/lyrics/place.ts), so they scroll and page with
// it; "Adjust lyrics" moves lines and saves only where they sit (numbers, never the text). On
// a big screen (1280px+) the "Side panel" switch also opens the whole text beside the chart.
// The text comes live from /api/lyrics and is kept only on this device (localStorage) for
// offline use; a server answer of "off", "hidden" or "none" deletes that copy.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { setLyricsHidden, setLyricsPick } from "@/app/api/lyrics/actions";
import { OfflineNote } from "@/app/OfflineRoot";
import type { ChartView } from "@/lib/chart";
import type { LyricLine } from "@/lib/lyrics/match";
import { saveMine, setPanel, syncMine, syncPanel, useMine, usePanel } from "@/lib/lyrics/mine";
import { barRows, decodePlacements, encodePlacements, findRow, placeLines, stepRow, type RowRef } from "@/lib/lyrics/place";
import { useNavMe } from "@/lib/nav/me";
import { rememberedUser } from "@/lib/offline/user";
import { OFFLINE_MSG, useOffline } from "@/lib/offline/status";
import { readPref, setPref } from "@/lib/prefs";
import { browserClient } from "@/lib/supabase/browser";
import type { ChartLyrics } from "./Chart";

type Source = { provider: string; id: number; title: string; artist: string; album: string | null };
type Answer =
  | { status: "ok"; text: string; lines?: LyricLine[]; synced?: boolean; source: Source; admin: boolean; songId?: string; pinned?: number | null }
  | { status: "none" | "hidden"; admin?: boolean; songId?: string; pinned?: number | null }
  | { status: "off" | "error" };
type Candidate = { id: number; title: string; artist: string; album: string | null; seconds: number | null; hasLyrics: boolean };

const CACHE = "bb.lyrics.cache.";
const cacheKey = (slug: string) => `${CACHE}${slug}`;
/** Kill switch / audience change: drop every song's saved lyrics on this phone. */
function clearAllCaches() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(CACHE)) localStorage.removeItem(k);
  } catch {
    // storage blocked
  }
}
const readCache = (slug: string): Answer | null => {
  try {
    const v = JSON.parse(readPref(cacheKey(slug)) ?? "null");
    return v?.status === "ok" ? (v as Answer) : null;
  } catch {
    return null;
  }
};

/** Does the /admin audience include this player? null = unknown (offline or still asking). */
let allowedAsk: Promise<boolean> | null = null;
export function useLyricsAllowed(): boolean | null {
  const offline = useOffline();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    if (offline) return;
    let alive = true;
    allowedAsk ??= (async () => {
      const { data, error } = await browserClient().rpc("lyrics_allowed");
      if (error) throw error;
      return data === true;
    })();
    allowedAsk.then(
      (v) => alive && setAllowed(v),
      () => {
        allowedAsk = null;
      },
    );
    return () => {
      alive = false;
    };
  }, [offline]);
  return offline ? null : allowed;
}

const WIDE = "(min-width: 1280px)";
const noop = () => () => {};
const useWide = () =>
  useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(WIDE);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
const useHydrated = () => useSyncExternalStore(noop, () => true, () => false);
/** Signed-in player's id: from the nav once it loaded, else the one remembered on this device. */
function useUid(): string | null {
  const me = useNavMe();
  const remembered = useSyncExternalStore(noop, () => rememberedUser()?.id ?? null, () => null);
  return me === undefined ? remembered : (me?.id ?? null);
}

/** Live from the server; the phone's copy when offline or on an error. Keeps that copy in step. */
async function fetchLyrics(slug: string, offline: boolean): Promise<Answer | null> {
  if (offline) return readCache(slug);
  try {
    const res = await fetch(`/api/lyrics?slug=${encodeURIComponent(slug)}`, { cache: "no-store" });
    const a = (await res.json()) as Answer;
    if (a.status === "ok") setPref(cacheKey(slug), JSON.stringify(a));
    else if (a.status === "off") clearAllCaches(); // kill switch: every saved song goes
    else if (a.status !== "error") setPref(cacheKey(slug), null); // hidden / none: drop this song's copy
    return a.status === "error" ? (readCache(slug) ?? a) : a;
  } catch {
    return readCache(slug) ?? { status: "error" };
  }
}
// One request per song per page (the song page and its Full song pop-up share it).
const asked = new Map<string, Promise<Answer | null>>();
function getLyrics(slug: string, offline: boolean, fresh: boolean): Promise<Answer | null> {
  const k = `${slug}|${offline}`;
  let p = fresh ? undefined : asked.get(k);
  if (!p) {
    p = fetchLyrics(slug, offline);
    asked.set(k, p);
    void p.then((a) => {
      if (!a || a.status === "error") asked.delete(k);
    });
  }
  return p;
}

type AdjustState = { slug: string; moved: Map<number, RowRef>; sel: number | null; err: string | null; busy: boolean };

/** Everything one song's lyrics need: the button, the lines under the bar rows, Adjust, the panel. */
export function useLyrics(slug: string, view: ChartView | null, { enabled = true }: { enabled?: boolean } = {}) {
  const hydrated = useHydrated();
  const allowed = useLyricsAllowed();
  const offline = useOffline();
  const wide = useWide();
  const uid = useUid();
  const mine = useMine(uid, slug);
  const panelOn = usePanel();
  const [got, setGot] = useState<{ slug: string; a: Answer | null } | null>(null);
  const [nonce, setNonce] = useState(0); // bump to fetch again (admin changes)

  // The saved copy only matters offline (parsing it on every render would cost stage mode).
  const visible = enabled && hydrated && (allowed === true || (allowed === null && offline && !!readCache(slug)));
  const on = visible && mine.shown;

  // Signed in: the account's choice for this song (and the side panel switch) win when newer.
  useEffect(() => {
    if (visible && uid && !offline) void syncMine(uid, slug);
  }, [visible, uid, slug, offline]);
  useEffect(() => {
    if (visible && wide && uid && !offline) void syncPanel(uid);
  }, [visible, wide, uid, offline]);

  useEffect(() => {
    if (!on) return;
    let alive = true;
    void getLyrics(slug, offline, nonce > 0).then((a) => alive && setGot({ slug, a }));
    return () => {
      alive = false;
    };
  }, [on, slug, offline, nonce]);
  const answer = on && got?.slug === slug ? got.a : null;
  const loading = on && answer === null;
  const reload = useCallback(async () => setNonce((n) => n + 1), []);
  // The audience no longer includes this player (kill switch): drop the copy.
  useEffect(() => {
    if (allowed === false) clearAllCaches();
  }, [allowed]);

  const ok = answer?.status === "ok" ? answer : null;
  const lines = ok?.lines ?? null;
  const record = ok?.source.id ?? null;
  const rowsOfChart = useMemo(() => (view ? barRows(view) : []), [view]);
  const saved = useMemo(
    () => (record !== null && mine.lrclib === record ? decodePlacements(mine.placements) : new Map<number, RowRef>()),
    [record, mine.lrclib, mine.placements],
  );
  const [adjust, setAdjust] = useState<AdjustState | null>(null);
  const adjusting = adjust?.slug === slug && ok ? adjust : null;
  const moved = adjusting?.moved ?? saved;
  const rows = useMemo(() => (on && view && lines?.length ? placeLines(view, lines, moved) : null), [on, view, lines, moved]);

  const panel = on && wide && panelOn && answer?.status !== "off";
  // Desktop side panel: give the page (and stage mode) room so the chart never sits under it.
  useEffect(() => {
    if (!panel) return;
    document.documentElement.classList.add("bb-lyrics-open");
    return () => document.documentElement.classList.remove("bb-lyrics-open");
  }, [panel]);

  const placedRow = (line: number) => {
    for (const [k, list] of rows ?? []) if (list.some((p) => p.line === line)) return k;
    return null;
  };
  const drop = (line: number, key: string) => {
    const r = rowsOfChart.find((x) => x.key === key);
    if (r) setAdjust((a) => a && { ...a, moved: new Map(a.moved).set(line, r.ref), sel: line, err: null });
  };
  const edit = {
    active: !!adjusting,
    selected: adjusting?.sel ?? null,
    err: adjusting?.err ?? null,
    busy: adjusting?.busy ?? false,
    canAdjust: !!lines?.length,
    start: () => setAdjust({ slug, moved: new Map(saved), sel: null, err: null, busy: false }),
    pick: (line: number) => setAdjust((a) => a && { ...a, sel: a.sel === line ? null : line }),
    drop,
    step: (d: -1 | 1) => {
      const sel = adjusting?.sel;
      const at = sel == null ? null : placedRow(sel);
      const to = at ? stepRow(rowsOfChart, at, d) : null;
      if (sel != null && to) drop(sel, to.key);
    },
    reset: () => setAdjust((a) => a && { ...a, moved: new Map(), sel: null }),
    cancel: () => setAdjust(null),
    save: async () => {
      if (!adjusting || record === null) return;
      if (offline) return setAdjust({ ...adjusting, err: OFFLINE_MSG });
      // Keep only lines whose bar row still exists; the rest are placed automatically again.
      const kept = new Map([...adjusting.moved].filter(([, ref]) => findRow(rowsOfChart, ref) >= 0));
      setAdjust({ ...adjusting, busy: true, err: null });
      try {
        await saveMine(uid, slug, { placements: encodePlacements(kept), lrclib: record });
        setAdjust(null);
      } catch {
        setAdjust({ ...adjusting, busy: false, err: "Couldn’t save to your account. Try again." });
      }
    },
  };

  const chart: ChartLyrics | undefined = rows
    ? { rows, adjust: adjusting ? { selected: adjusting.sel, pick: edit.pick, drop } : undefined }
    : undefined;

  return {
    slug,
    visible,
    on,
    answer,
    loading,
    offline,
    wide,
    panel,
    panelOn,
    admin: !!answer && "admin" in answer && !!answer.admin,
    rows,
    chart,
    edit,
    reload,
    toggle: () => {
      if (on) setAdjust(null);
      void saveMine(uid, slug, { shown: !mine.shown }).catch(() => {});
    },
    setPanel: (v: boolean) => setPanel(uid, v),
  };
}
export type SongLyrics = ReturnType<typeof useLyrics>;

/** What the Lyrics button says. Quiet when there's nothing to show. */
function buttonLabel(l: SongLyrics): string {
  if (!l.on) return "Lyrics";
  if (l.loading) return "Lyrics…";
  switch (l.answer?.status) {
    case "none":
      return "No lyrics found";
    case "hidden":
      return "Lyrics hidden";
    case "error":
      return "Couldn’t load lyrics";
    default:
      return "Lyrics";
  }
}

/**
 * The song's Lyrics button, with the "Side panel" switch on a big screen. On the song page
 * (`page`) also "Adjust lyrics" and, for admins, Hide / Pick another.
 */
export function LyricsControls({ lyr, page = false }: { lyr: SongLyrics; page?: boolean }) {
  const [tools, setTools] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!lyr.visible || lyr.answer?.status === "off") return null;
  const label = buttonLabel(lyr);
  const lit = lyr.on && lyr.answer?.status === "ok";
  const showPanel = lyr.wide && lyr.on && lyr.answer?.status === "ok";
  if (!page) {
    // Stage header: same height as the other header buttons.
    const quiet = "h-11 shrink-0 rounded-bb-control px-2 text-sm font-bold active:bg-bb-case-charcoal";
    return (
      <>
        <button type="button" onClick={lyr.toggle} aria-pressed={lyr.on} className={`${quiet} ${lit ? "text-bb-downbeat-amber" : "text-bb-cue-gray"}`}>
          {label}
        </button>
        {showPanel && (
          <button type="button" onClick={() => lyr.setPanel(!lyr.panelOn)} aria-pressed={lyr.panelOn} className={`${quiet} ${lyr.panelOn ? "text-bb-downbeat-amber" : "text-bb-cue-gray"}`}>
            Side panel
          </button>
        )}
      </>
    );
  }
  const small = "bb-btn h-12 px-3 text-base";
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <button type="button" onClick={lyr.toggle} aria-pressed={lyr.on} className={`${small} ${lit ? "bb-on" : lyr.on ? "bb-btn-quiet text-bb-cue-gray" : "bb-btn-secondary"}`}>
        {label}
      </button>
      {showPanel && (
        <button type="button" onClick={() => lyr.setPanel(!lyr.panelOn)} aria-pressed={lyr.panelOn} className={`${small} ${lyr.panelOn ? "bb-on" : "bb-btn-secondary"}`}>
          Side panel
        </button>
      )}
      {lyr.on && lyr.edit.canAdjust && !lyr.edit.active && (
        <button
          type="button"
          onClick={() => {
            if (lyr.offline) return setMsg(OFFLINE_MSG);
            setMsg(null);
            lyr.edit.start();
          }}
          className={`${small} bb-btn-secondary`}
        >
          Adjust lyrics
        </button>
      )}
      {lyr.on && lyr.admin && !lyr.offline && lyr.answer && (
        <button type="button" onClick={() => setTools(!tools)} aria-expanded={tools} className={`${small} bb-btn-quiet text-bb-cue-gray`}>
          Lyrics admin
        </button>
      )}
      {msg && <p className="basis-full text-base text-bb-cue-gray">{msg}</p>}
      {tools && lyr.on && lyr.admin && !lyr.offline && lyr.answer && (
        <div className="basis-full">
          <AdminTools slug={lyr.slug} answer={lyr.answer} reload={lyr.reload} />
        </div>
      )}
    </div>
  );
}

/** "Adjust lyrics": pinned to the bottom of the screen while the player moves lines. */
export function AdjustBar({ lyr }: { lyr: SongLyrics }) {
  const e = lyr.edit;
  if (!e.active) return null;
  const icon = "bb-btn bb-btn-secondary size-12 shrink-0 p-0 text-xl";
  return (
    <div className="fixed bottom-[var(--bb-tabs-bottom,0px)] left-[var(--bb-rail,0px)] right-0 z-40 border-t border-bb-rule-gray bg-bb-house-black p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <p className="mb-2 px-1 text-base text-bb-cue-gray" aria-live="polite">
        {e.err ?? (e.selected == null ? "Drag a line to another bar row, or tap a line and move it with ▲ ▼." : "Move the picked line a row up or down, or drag it.")}
      </p>
      <div className="flex items-center gap-2">
        <button type="button" disabled={e.selected == null} onClick={() => e.step(-1)} aria-label="Move the line up a row" className={icon}>
          ▲
        </button>
        <button type="button" disabled={e.selected == null} onClick={() => e.step(1)} aria-label="Move the line down a row" className={icon}>
          ▼
        </button>
        <button type="button" onClick={e.reset} className="bb-btn bb-btn-quiet h-12 px-2 text-base text-bb-cue-gray">
          Reset
        </button>
        <span className="flex-1" />
        <button type="button" onClick={e.cancel} className="bb-btn bb-btn-secondary h-12 px-3 text-base">
          Cancel
        </button>
        <button type="button" disabled={e.busy} onClick={() => void e.save()} className="bb-btn bb-btn-primary h-12 px-4 text-base">
          Save
        </button>
      </div>
    </div>
  );
}

/** Desktop (1280px+) side panel with the whole text, when the player switched it on. */
export function LyricsPanel({ lyr }: { lyr: SongLyrics }) {
  if (!lyr.panel) return null;
  return (
    <aside aria-label="Lyrics" className="fixed bottom-0 right-0 top-0 z-[55] flex w-[24rem] flex-col border-l border-bb-rule-gray bg-bb-house-black">
      <header className="flex h-12 shrink-0 items-center border-b border-bb-rule-gray pl-4 pr-1">
        <h2 className="flex-1 text-lg font-bold">Lyrics</h2>
        <button type="button" onClick={() => lyr.setPanel(false)} aria-label="Close the side panel" className="bb-btn bb-btn-quiet size-11 p-0 text-2xl text-bb-cue-gray">
          ✕
        </button>
      </header>
      <Body slug={lyr.slug} answer={lyr.answer} loading={lyr.loading} offline={lyr.offline} reload={lyr.reload} />
    </aside>
  );
}

type BodyProps = { slug: string; answer: Answer | null; loading: boolean; offline: boolean; reload: () => Promise<void> };

function Body({ slug, answer, loading, offline, reload }: BodyProps) {
  const admin = !!answer && "admin" in answer && !!answer.admin;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      {loading && !answer && <p className="text-lg text-bb-cue-gray">Loading…</p>}
      {answer?.status === "ok" && (
        <>
          <p className="whitespace-pre-line text-lg leading-relaxed">{answer.text}</p>
          <p className="mt-4 text-sm text-bb-cue-gray">
            From LRCLIB (community lyrics){offline ? " · saved on this phone" : ""}: {answer.source.title} · {answer.source.artist}
          </p>
        </>
      )}
      {answer?.status === "none" && <p className="text-lg text-bb-cue-gray">No lyrics found.</p>}
      {answer?.status === "hidden" && <p className="text-lg text-bb-cue-gray">Lyrics are hidden for this song.</p>}
      {answer?.status === "error" && <p className="text-lg text-bb-cue-gray">Couldn’t load lyrics right now.</p>}
      {offline && !answer && <OfflineNote />}
      {admin && !offline && answer && <AdminTools slug={slug} answer={answer} reload={reload} />}
    </div>
  );
}

function AdminTools({ slug, answer, reload }: { slug: string; answer: Answer; reload: () => Promise<void> }) {
  const songId = "songId" in answer ? answer.songId : undefined;
  const pinned = "pinned" in answer ? (answer.pinned ?? null) : null;
  const hidden = answer.status === "hidden";
  const [list, setList] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!songId) return null;
  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    setErr(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) return setErr(r.error ?? "That didn’t work.");
    setList(null);
    await reload();
  };
  const more = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/lyrics?slug=${encodeURIComponent(slug)}&candidates=1`, { cache: "no-store" });
      const a = await res.json();
      if (a.status === "candidates") setList(a.candidates as Candidate[]);
      else setErr("Couldn’t load other matches.");
    } catch {
      setErr("Couldn’t load other matches.");
    } finally {
      setBusy(false);
    }
  };
  const mmss = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "");
  return (
    <div className="mt-6 flex flex-col gap-2 border-t border-bb-rule-gray pt-3">
      <p className="text-sm text-bb-cue-gray">Admin</p>
      <button type="button" disabled={busy} onClick={() => act(() => setLyricsHidden(songId, !hidden))} className="bb-btn bb-btn-secondary h-12 px-4 text-base">
        {hidden ? "Show lyrics again" : "Hide lyrics for this song"}
      </button>
      {!hidden && (
        <button type="button" disabled={busy} onClick={more} className="bb-btn bb-btn-secondary h-12 px-4 text-base">
          Wrong lyrics? Pick another
        </button>
      )}
      {pinned && (
        <button type="button" disabled={busy} onClick={() => act(() => setLyricsPick(songId, null))} className="bb-btn bb-btn-quiet h-12 px-4 text-base">
          Back to automatic match
        </button>
      )}
      {err && <p className="bb-error text-base">{err}</p>}
      {list && (
        <ul className="flex flex-col gap-2">
          {list.length === 0 && <li className="text-base text-bb-cue-gray">No other matches.</li>}
          {list.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={busy || !c.hasLyrics}
                onClick={() => act(() => setLyricsPick(songId, c.id))}
                className="flex min-h-12 w-full flex-col items-start border border-bb-rule-gray bg-bb-case-charcoal px-3 py-2 text-left active:bg-bb-rule-gray"
              >
                <span className="text-base font-semibold">
                  {c.title} · {c.artist} {c.id === pinned ? "(picked)" : ""}
                </span>
                <span className="text-sm text-bb-cue-gray">{[c.album, mmss(c.seconds), c.hasLyrics ? null : "no lyrics"].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
