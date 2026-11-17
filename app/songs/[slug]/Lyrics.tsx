"use client";

// Lyrics beside the chart (Q7). Shown only when the player turned Lyrics on in Settings AND
// the /admin audience includes them (the server checks again on every request). The text
// comes live from /api/lyrics and is kept only on this device (localStorage) for offline use;
// a server answer of "off", "hidden" or "none" deletes that copy. Never stored by us otherwise.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { setLyricsHidden, setLyricsPick } from "@/app/api/lyrics/actions";
import { OfflineNote } from "@/app/OfflineRoot";
import { useOffline } from "@/lib/offline/status";
import { PREF, readPref, setPref, usePref } from "@/lib/prefs";
import { browserClient } from "@/lib/supabase/browser";

type Source = { provider: string; id: number; title: string; artist: string; album: string | null };
type Answer =
  | { status: "ok"; text: string; source: Source; admin: boolean; songId: string; pinned: number | null }
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

export default function Lyrics({ slug, stage = false }: { slug: string; stage?: boolean }) {
  const hydrated = useHydrated();
  const on = usePref(PREF.lyrics) === "1";
  const allowed = useLyricsAllowed();
  const offline = useOffline();
  const wide = useWide();
  const [open, setOpen] = useState(false); // phone drawer
  const full = usePref(PREF.lyricsFull, "session") === "1";
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [nonce, setNonce] = useState(0); // bump to fetch again (admin changes)

  const cached = hydrated ? readCache(slug) : null;
  const visible = hydrated && on && (allowed === true || (allowed === null && offline && !!cached));
  const showing = visible && (wide || open);

  useEffect(() => {
    if (!showing) return;
    let alive = true;
    void fetchLyrics(slug, offline).then((a) => alive && setAnswer(a));
    return () => {
      alive = false;
    };
  }, [showing, slug, offline, nonce]);
  const load = useCallback(async () => setNonce((n) => n + 1), []);
  const loading = showing && answer === null;
  // The audience no longer includes this player (kill switch): drop the copy.
  useEffect(() => {
    if (allowed === false) clearAllCaches();
  }, [allowed]);
  // Desktop side panel: give the page (and stage mode) room so the chart never sits under it.
  useEffect(() => {
    if (!(visible && wide)) return;
    document.documentElement.classList.add("bb-lyrics-open");
    return () => document.documentElement.classList.remove("bb-lyrics-open");
  }, [visible, wide]);

  if (!visible || answer?.status === "off") return null;

  if (wide) {
    return (
      <aside aria-label="Lyrics" className="fixed bottom-0 right-0 top-0 z-[55] flex w-[24rem] flex-col border-l border-bb-rule-gray bg-bb-house-black">
        <header className="flex h-12 shrink-0 items-center border-b border-bb-rule-gray px-4">
          <h2 className="flex-1 text-lg font-bold">Lyrics</h2>
        </header>
        <Body slug={slug} answer={answer} loading={loading} offline={offline} reload={load} />
      </aside>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`bb-btn bb-btn-secondary fixed z-[52] h-12 px-4 text-lg ${stage ? "right-2 top-14" : "bottom-[calc(var(--bb-tabs-bottom,0px)+1rem)] right-4"}`}
      >
        Lyrics
      </button>
    );
  }
  return <Drawer full={full} onClose={() => setOpen(false)} slug={slug} answer={answer} loading={loading} offline={offline} reload={load} />;
}

type BodyProps = { slug: string; answer: Answer | null; loading: boolean; offline: boolean; reload: () => Promise<void> };

/** Phone drawer: opens at half height; drag the grip up (or tap "Full") for full height. */
function Drawer({ full, onClose, ...body }: { full: boolean; onClose: () => void } & BodyProps) {
  const y0 = useRef<number | null>(null);
  const setFull = (v: boolean) => setPref(PREF.lyricsFull, v ? "1" : null, "session");
  return (
    <section
      aria-label="Lyrics"
      className={`fixed inset-x-0 bottom-0 z-[60] flex flex-col border-t border-bb-rule-gray bg-bb-house-black pb-[env(safe-area-inset-bottom)] ${full ? "h-[92dvh]" : "h-[50dvh]"}`}
    >
      <header
        className="flex h-12 shrink-0 touch-none items-center gap-2 border-b border-bb-rule-gray pl-4 pr-1"
        onPointerDown={(e) => {
          y0.current = e.clientY;
        }}
        onPointerUp={(e) => {
          if (y0.current === null) return;
          const dy = e.clientY - y0.current;
          y0.current = null;
          if (dy < -40) setFull(true);
          else if (dy > 40) {
            if (full) setFull(false);
            else onClose();
          }
        }}
      >
        <span className="mr-1 h-1 w-8 bg-bb-rule-gray" aria-hidden />
        <h2 className="flex-1 text-lg font-bold">Lyrics</h2>
        <button type="button" onClick={() => setFull(!full)} className="bb-btn bb-btn-quiet h-11 px-3 text-base">
          {full ? "Half" : "Full"}
        </button>
        <button type="button" onClick={onClose} aria-label="Close lyrics" className="bb-btn bb-btn-quiet size-11 p-0 text-2xl text-bb-cue-gray">
          ✕
        </button>
      </header>
      <Body {...body} />
    </section>
  );
}

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
