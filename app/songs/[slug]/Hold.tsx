"use client";

// Press and hold one number/chord (song page + stage mode) -> bottom sheet:
// "Flag for me" (private marker + note) or "Suggest an edit" (the normal editor, on that bar).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { pretty, type ChartView } from "@/lib/chart";
import { refAt, refKey, refMatches, refQuery, sectionBars, spotLabel, type BarRef } from "@/lib/flags/ref";
import { OFFLINE_MSG, useOffline } from "@/lib/offline/status";
import { addFlag, moveGuestFlags, NOTE_MAX, removeFlags, setFlagNote, useSongFlags, type PersonalFlag } from "@/lib/flags/store";
import { PREF, setPref, usePref } from "@/lib/prefs";
import type { HoldMarks } from "./Chart";
import { useGesture } from "./hooks";

export const HOLD_MS = 500;
const MOVE_PX = 10; // finger travel that cancels a hold (same as the tap tolerance)

export interface Spot {
  ref: BarRef;
  shown: string; // as drawn right now: "5-" or "Bm"
  split: boolean;
}

/**
 * Long-press on a chart beat. Combine `handlers` with the swipe/tap gesture via withHold() and
 * check `held()` in its callbacks, so a hold never also counts as a tap or a swipe.
 */
export function useHold(view: ChartView | null, chords: boolean, onHold: (spot: Spot) => void) {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const fired = useRef(false);
  const cancel = () => {
    window.clearTimeout(timer.current);
    start.current = null;
  };
  const handlers = {
    onPointerDown: (e: ReactPointerEvent) => {
      fired.current = false;
      cancel();
      if (e.button !== 0 || !view) return;
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-beat]");
      if (!el?.dataset.beat) return;
      const [s, b, p] = el.dataset.beat.split(".").map(Number);
      start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      timer.current = window.setTimeout(() => {
        start.current = null;
        const ref = refAt(view, s, b, p);
        const beats = sectionBars(view, s)[b];
        if (!ref || !beats) return;
        fired.current = true;
        try {
          navigator.vibrate?.(15);
        } catch {
          // no haptics here (iPhone): the highlight is the feedback
        }
        const beat = beats[p];
        onHold({ ref, shown: pretty(chords ? beat.chord : beat.num), split: beats.length > 1 });
      }, HOLD_MS);
    },
    onPointerMove: (e: ReactPointerEvent) => {
      const st = start.current;
      if (st && st.id === e.pointerId && Math.hypot(e.clientX - st.x, e.clientY - st.y) > MOVE_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    // No text-selection menu or callout on chart items (Android long-press fires contextmenu).
    onContextMenu: (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("[data-beat]")) e.preventDefault();
    },
  };
  return { handlers, held: () => fired.current };
}

/** One element's handlers: the hold runs first, then the swipe/tap gesture (pointer capture stays on one element). */
export function withHold<G extends Record<string, ((e: never) => void) | undefined>>(gesture: G, hold: ReturnType<typeof useHold>["handlers"]) {
  const out: Record<string, (e: never) => void> = {};
  const keys = new Set([...Object.keys(gesture), ...Object.keys(hold)]);
  for (const k of keys) {
    const a = (hold as Record<string, ((e: never) => void) | undefined>)[k];
    const b = gesture[k];
    out[k] = (e: never) => {
      a?.(e);
      b?.(e);
    };
  }
  return out as unknown as G & ReturnType<typeof useHold>["handlers"];
}

/** Markers for the chart: flags that still match the chart, plus the held spot. */
export function useHoldMarks(slug: string, view: ChartView | null, selected: Spot | null): HoldMarks {
  const { flags } = useSongFlags(slug);
  return useMemo(
    () => ({
      flagged: new Set(flags.filter((f) => refMatches(view, f.ref)).map((f) => refKey(f.ref))),
      selected: selected ? refKey(selected.ref) : null,
    }),
    [flags, view, selected],
  );
}

const big = "flex min-h-14 w-full items-center justify-center rounded-xl px-4 text-xl font-bold";
const primary = `${big} bg-accent text-black active:opacity-80`;
const plain = `${big} border border-line bg-panel text-foreground active:bg-background`;

/**
 * The bottom sheet. Rendered on <body> so it always uses the app's dark high-contrast colors,
 * even over a light stage screen. A swipe on the backdrop closes it and changes song.
 */
export function HoldSheet({
  slug,
  spot,
  onMine,
  onClose,
  onSwipe,
}: {
  slug: string;
  spot: Spot;
  onMine: boolean;
  onClose: () => void;
  onSwipe: (d: -1 | 1) => void;
}) {
  const router = useRouter();
  const { flags, signedIn } = useSongFlags(slug);
  const offline = useOffline();
  // Signed-in flags live in the account, so they need a connection; signed-out flags stay on this phone.
  const flagsOff = offline && signedIn;
  const existing = flags.find((f) => refKey(f.ref) === refKey(spot.ref)) ?? null;
  const [mode, setMode] = useState<"menu" | "note" | "signin">("menu");
  const [note, setNote] = useState(existing?.note ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opened] = useState(() => performance.now());
  // The finger that opened the sheet may still be down: ignore its release.
  const backdrop = useGesture({ onSwipe, onTap: () => performance.now() - opened > 400 && onClose() });

  const editHref = `/songs/${slug}/edit?${refQuery(spot.ref)}&from=${onMine ? "mine" : "public"}`;
  const run = async (f: () => Promise<string | null>) => {
    setBusy(true);
    setMsg(null);
    const err = await f();
    setBusy(false);
    if (err) setMsg(err);
    else onClose();
  };
  const suggest = () => {
    if (!signedIn) return setMode("signin");
    onClose(); // the song page may stay mounted in the background: don't leave the sheet open there
    router.push(editHref);
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col justify-end text-foreground" role="dialog" aria-modal="true" aria-label="Chart spot">
      <div {...backdrop} className="min-h-0 flex-1 touch-pan-y bg-black/70" />
      <div className="rounded-t-2xl border-t border-line bg-panel px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl">
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-line" aria-hidden />
        <p className="mb-4 flex items-baseline gap-3">
          <span className="text-4xl font-bold">{spot.shown}</span>
          <span className="text-xl text-muted">{spotLabel(spot.ref, spot.split)}</span>
        </p>
        {mode === "menu" && (
          <div className="grid gap-3">
            {existing ? (
              <>
                {existing.note && <p className="text-lg">“{existing.note}”</p>}
                <button className={`${primary} disabled:opacity-40`} disabled={flagsOff} onClick={() => setMode("note")}>
                  {existing.note ? "Edit note" : "Add a note"}
                </button>
                <button className={`${plain} disabled:opacity-40`} disabled={busy || flagsOff} onClick={() => run(() => removeFlags([existing.id]))}>
                  Remove flag
                </button>
              </>
            ) : (
              <button className={`${primary} disabled:opacity-40`} disabled={flagsOff} onClick={() => setMode("note")}>
                Flag for me
              </button>
            )}
            <button className={`${plain} disabled:opacity-40`} disabled={offline} onClick={suggest}>
              Suggest an edit
            </button>
            {offline && <p className="text-lg text-amber-200">{OFFLINE_MSG}</p>}
            <button className={`${plain} text-muted`} onClick={onClose}>
              Cancel
            </button>
          </div>
        )}
        {mode === "note" && (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => (existing ? setFlagNote(existing.id, note) : addFlag(slug, spot.ref, note, onMine)));
            }}
          >
            <label htmlFor="flag-note" className="text-lg text-muted">
              Note for you (optional, no lyrics)
            </label>
            <input
              id="flag-note"
              value={note}
              maxLength={NOTE_MAX}
              onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
              placeholder="e.g. watch the push"
              enterKeyHint="done"
              className="min-h-14 rounded-xl border border-line bg-background px-4 text-xl"
            />
            <button type="submit" className={primary} disabled={busy}>
              {busy ? "Saving…" : existing ? "Save note" : "Save flag"}
            </button>
            <button type="button" className={plain} onClick={() => setMode("menu")}>
              Back
            </button>
            {!signedIn && <p className="text-base text-muted">Saved on this phone. Sign in to keep flags in your account.</p>}
          </form>
        )}
        {mode === "signin" && (
          <div className="grid gap-3">
            <p className="text-xl">Sign in to suggest an edit.</p>
            <Link href={`/login?next=${encodeURIComponent(editHref)}`} className={primary}>
              Sign in
            </Link>
            <button className={plain} onClick={() => setMode("menu")}>
              Back
            </button>
          </div>
        )}
        {msg && (
          <p role="alert" className="mt-3 text-lg text-red-300">
            {msg}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Signed in with flags still on this phone from before: offer to move them to the account. */
export function MoveFlagsBanner({ slug }: { slug: string }) {
  const { waiting } = useSongFlags(slug);
  const later = usePref(PREF.flagsLater, "session") === "1";
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!waiting || later) return null;
  return (
    <div className="mb-3 rounded-xl border border-violet-400/60 bg-violet-400/10 p-3">
      <p className="mb-2 text-lg">
        Move {waiting} {waiting === 1 ? "flag" : "flags"} on this phone to your account?
      </p>
      <div className="flex gap-2">
        <button
          className="min-h-12 flex-1 rounded-xl bg-violet-300 px-4 text-lg font-bold text-black disabled:opacity-50"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMsg(await moveGuestFlags());
            setBusy(false);
          }}
        >
          {busy ? "Moving…" : "Move"}
        </button>
        <button className="min-h-12 flex-1 rounded-xl border border-line px-4 text-lg" onClick={() => setPref(PREF.flagsLater, "1", "session")}>
          Not now
        </button>
      </div>
      {msg && <p className="mt-2 text-lg text-red-300">{msg}</p>}
    </div>
  );
}

/** Song page: this player's flags on the song, with Clear and Clear all. */
export function MyFlags({ slug, view }: { slug: string; view: ChartView | null }) {
  const { flags } = useSongFlags(slug);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!flags.length) return null;
  const sorted = [...flags].sort((a, b) => a.ref.section - b.ref.section || a.ref.bar - b.ref.bar || a.ref.beat - b.ref.beat);
  const clear = async (ids: string[]) => {
    setMsg(await removeFlags(ids));
    setConfirm(false);
  };
  const label = (f: PersonalFlag) => {
    const beats = view ? sectionBars(view, f.ref.section)[f.ref.bar] : undefined;
    return spotLabel(f.ref, (beats?.length ?? 1) > 1);
  };
  return (
    <section className="mt-8 rounded-xl border border-line p-4" aria-labelledby="my-flags">
      <h2 id="my-flags" className="mb-1 text-xl font-bold">
        <span className="mr-2 inline-block size-3 rounded-full bg-violet-400 align-middle" aria-hidden />
        My flags ({flags.length})
      </h2>
      <p className="mb-3 text-base text-muted">Only you can see these. Press and hold any chord to add one.</p>
      <ul className="grid gap-2">
        {sorted.map((f) => {
          const ok = refMatches(view, f.ref);
          return (
            <li key={f.id} className="flex items-center gap-3 rounded-lg bg-panel px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-lg">
                  <b>{pretty(f.ref.text)}</b> <span className="text-muted">· {label(f)}</span>
                </p>
                {f.note && <p className="text-lg">“{f.note}”</p>}
                {!ok && <p className="text-base text-amber-300">Chart changed since you flagged this.</p>}
              </div>
              <button className="min-h-11 shrink-0 rounded-lg border border-line px-3 text-lg" onClick={() => clear([f.id])} aria-label={`Clear flag at ${label(f)}`}>
                Clear
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {confirm ? (
          <>
            <span className="text-lg">Clear all {flags.length}?</span>
            <button className="min-h-11 rounded-lg bg-red-400 px-4 text-lg font-bold text-black" onClick={() => clear(flags.map((f) => f.id))}>
              Yes, clear all
            </button>
            <button className="min-h-11 rounded-lg border border-line px-4 text-lg" onClick={() => setConfirm(false)}>
              No
            </button>
          </>
        ) : (
          <button className="min-h-11 rounded-lg border border-line px-4 text-lg text-muted" onClick={() => setConfirm(true)}>
            Clear all
          </button>
        )}
      </div>
      {msg && <p className="mt-2 text-lg text-red-300">{msg}</p>}
    </section>
  );
}
