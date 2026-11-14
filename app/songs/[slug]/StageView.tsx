"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { clampSpeed, clampStageSize, MAX_SPEED, MAX_STAGE_SIZE, pretty, SPEEDS, suggestSpeed } from "@/lib/chart";
import { PREF, setPref, usePref } from "@/lib/prefs";
import Chart from "./Chart";
import { btn, BpmToggle, DisplayControls, off, on } from "./controls";
import { usePickedChart } from "@/lib/personal/versions";
import { useGo, useLocalNav } from "@/lib/offline/nav";
import { FONTS, useChartState, useGesture, useSongKeys, useSongNav, type FontId, type KeyControl, type Neighbors } from "./hooks";
import { recordRecent } from "@/lib/search/recent";
import { HoldSheet, useHold, useHoldMarks, withHold, type Spot } from "./Hold";

const FIT_MIN = 30; // px: smallest size we shrink to so the whole chart fits without scrolling
const SCROLL_SIZE = 40; // px: size used when it can't fit and has to scroll (if the width allows)
const PAD_Y = 16; // scroller py-2
const HIDE_MS = 3500;
// Stage-only looks (app/globals.css): Dark is pure black; Light is the high-contrast paper look.
const stageLook = (light: boolean) => (light ? "bb-stage-light" : "bb-stage-dark");
const num = (s: string | null) => (s && Number.isFinite(Number(s)) ? Number(s) : null);

function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let dead = false;
    const request = async () => {
      try {
        if (document.visibilityState !== "visible" || !("wakeLock" in navigator)) return;
        const l = await navigator.wakeLock.request("screen");
        if (dead) l.release().catch(() => {});
        else lock = l;
      } catch {
        // not allowed or not supported: ignore
      }
    };
    request();
    const onVis = () => document.visibilityState === "visible" && request();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      dead = true;
      document.removeEventListener("visibilitychange", onVis);
      lock?.release().catch(() => {});
    };
  }, []);
}

/** Setlist play mode: the parent owns the order, the session key and moving between songs. */
export interface StageSet {
  count: string; // "3 of 18"
  next: string | null; // next song's title; null on the last song
  note: string | null;
  keyCtl: KeyControl;
  go: (d: -1 | 1) => boolean; // false when there is no song that way
  onJump: () => void;
  onExit: () => void;
}

export default function StageView({
  slug,
  title,
  chartText,
  neighbors,
  set,
}: {
  slug: string;
  title: string;
  chartText: string;
  neighbors: Neighbors;
  set?: StageSet;
}) {
  // The player's own version, if they have one (one tap on the chip flips to public).
  const pick = usePickedChart(slug, chartText);
  const s = useChartState(slug, pick.text, set?.keyCtl);
  const nav = useSongNav(slug, neighbors);
  useEffect(() => recordRecent(slug), [slug]);
  const router = useRouter();
  const goTo = useGo();
  const local = useLocalNav();
  const scroller = useRef<HTMLDivElement>(null);
  const chartEl = useRef<HTMLDivElement>(null);
  useWakeLock();
  const theme = usePref(PREF.stageTheme);

  // --- text size: auto-fit unless the player set one -------------------------------------
  const savedSize = num(usePref(PREF.size));
  const manual = clampStageSize(savedSize);
  // Old devices may have saved a size above the cap (or junk): rewrite it once so it stays capped.
  useEffect(() => {
    if (savedSize !== manual) setPref(PREF.size, manual === null ? null : String(manual));
  }, [savedSize, manual]);
  const [autoSize, setAutoSize] = useState<number | null>(null);
  const [fitW, setFitW] = useState<number | null>(null); // largest size whose bars still fit the width
  const [tick, setTick] = useState(0); // bumps on resize / font load to re-measure
  // A manual size never goes past the width fit, so bars stay whole and aligned at any font.
  const fontPx = manual ? Math.min(manual, fitW ?? manual) : (autoSize ?? 32);

  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    let w = box.clientWidth;
    let h = box.clientHeight;
    const ro = new ResizeObserver(() => {
      if (box.clientWidth !== w || box.clientHeight !== h) {
        w = box.clientWidth;
        h = box.clientHeight;
        setTick((t) => t + 1);
      }
    });
    ro.observe(box);
    document.fonts?.ready.then(() => setTick((t) => t + 1)).catch(() => {});
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const box = scroller.current;
    const el = chartEl.current;
    if (!box || !el) return;
    const H = box.clientHeight - PAD_Y;
    const bars = () => el.querySelectorAll<HTMLElement>("[data-bar]");
    const set = (px: number) => (el.style.fontSize = `${px}px`);
    const fitsW = () => el.scrollWidth <= el.clientWidth + 1 && [...bars()].every((b) => b.scrollWidth <= b.clientWidth + 1);
    const fitsH = () => el.offsetHeight <= H;
    const search = (lo: number, hi: number, ok: () => boolean) => {
      while (hi - lo > 0.5) {
        const m = (lo + hi) / 2;
        set(m);
        if (ok()) lo = m;
        else hi = m;
      }
      return lo;
    };
    set(MAX_STAGE_SIZE);
    const wFit = fitsW() ? MAX_STAGE_SIZE : Math.floor(search(10, MAX_STAGE_SIZE, fitsW));
    setFitW(wFit);
    if (manual) {
      set(Math.min(manual, wFit));
      return;
    }
    set(wFit);
    let size = wFit;
    if (!fitsH()) {
      const hFit = search(10, wFit, fitsH);
      size = hFit >= FIT_MIN ? hFit : Math.min(wFit, SCROLL_SIZE);
    }
    size = Math.floor(size);
    set(size);
    setAutoSize(size);
  }, [manual, s.view, s.chords, s.font, tick]);

  // --- scrolling ------------------------------------------------------------------------
  const [scrollable, setScrollable] = useState(false);
  const [suggested, setSuggested] = useState<number | null>(null);
  useLayoutEffect(() => {
    const box = scroller.current;
    const el = chartEl.current;
    if (!box || !el || !s.view) return;
    const dist = el.offsetHeight + PAD_Y - box.clientHeight;
    setScrollable(dist > 2);
    setSuggested(suggestSpeed(s.view, dist, fontPx));
  }, [fontPx, s.view, s.chords, s.font, tick, autoSize]);

  const savedSongSpeed = num(usePref(PREF.songSpeed(slug)));
  const savedDeviceSpeed = num(usePref(PREF.speed));
  const songSpeed = savedSongSpeed === null ? null : clampSpeed(savedSongSpeed);
  const deviceSpeed = savedDeviceSpeed === null ? null : clampSpeed(savedDeviceSpeed);
  // Saved speeds from before the cap: rewrite them so storage never holds more than MAX_SPEED.
  useEffect(() => {
    if (savedDeviceSpeed !== null && savedDeviceSpeed !== deviceSpeed) setPref(PREF.speed, String(deviceSpeed));
    if (savedSongSpeed !== null && savedSongSpeed !== songSpeed) setPref(PREF.songSpeed(slug), String(songSpeed));
  }, [slug, savedDeviceSpeed, deviceSpeed, savedSongSpeed, songSpeed]);
  const [speedOverride, setSpeedOverride] = useState<number | null>(null);
  // The player's own speed wins; the BPM suggestion only seeds a device that never set one.
  const speed = clampSpeed(speedOverride ?? songSpeed ?? deviceSpeed ?? suggested ?? 5);
  const setSpeed = (n: number) => {
    const v = clampSpeed(n);
    setSpeedOverride(v);
    setPref(PREF.speed, String(v));
    if (songSpeed !== null) setPref(PREF.songSpeed(slug), String(v));
  };

  // Always start paused (also covers prefers-reduced-motion). Never auto-advances songs.
  const [playing, setPlaying] = useState(false);
  const play = () => {
    const box = scroller.current;
    if (!box || !scrollable) return;
    if (box.scrollTop >= box.scrollHeight - box.clientHeight - 1) box.scrollTop = 0;
    setPlaying(true);
  };
  useEffect(() => {
    const box = scroller.current;
    if (!playing || !box) return;
    let pos = box.scrollTop;
    let last = performance.now();
    let raf = 0;
    const pxPerSec = SPEEDS[speed - 1] * fontPx;
    const step = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000); // cap so a stalled frame never jumps far
      last = now;
      pos += pxPerSec * dt; // fractional: smooth even at very slow speeds
      const max = box.scrollHeight - box.clientHeight;
      if (pos >= max) {
        box.scrollTop = max;
        setPlaying(false); // stop at the end; never jump to the next song
        return;
      }
      box.scrollTop = pos;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, fontPx]);

  // --- controls auto-hide ------------------------------------------------------------------
  const [shown, setShown] = useState(true);
  const [panel, setPanelState] = useState(false);
  const panelRef = useRef(false);
  const hideTimer = useRef<number | undefined>(undefined);
  const startHide = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => !panelRef.current && setShown(false), HIDE_MS);
  }, []);
  const poke = useCallback(() => {
    setShown(true);
    startHide();
  }, [startHide]);
  const setPanel = (v: boolean) => {
    panelRef.current = v;
    setPanelState(v);
    poke();
  };
  useEffect(() => {
    startHide();
    return () => window.clearTimeout(hideTimer.current);
  }, [startHide]);

  // --- moving between songs ---------------------------------------------------------------
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 1500);
    return () => window.clearTimeout(t);
  }, [toast]);
  const [spot, setSpot] = useState<Spot | null>(null); // press-and-hold sheet
  const go = (d: -1 | 1) => {
    setSpot(null);
    if (set) {
      if (!set.go(d)) setToast(d > 0 ? "Last song in the set" : "First song in the set");
      return;
    }
    const t = d > 0 ? nav.next : nav.prev;
    if (t) goTo(`/songs/${t.slug}/stage`);
    else setToast(d > 0 ? "Last song in the list" : "First song in the list");
  };
  const exit = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (set) set.onExit();
    else goTo(`/songs/${slug}`);
  };
  useEffect(() => {
    if (!set && nav.next && !local) router.prefetch(`/songs/${nav.next.slug}/stage`);
  }, [set, nav.next, router, local]);

  useSongKeys(go, (e) => {
    if (e.key === " ") {
      e.preventDefault();
      if (playing) setPlaying(false);
      else play();
      poke();
      return true;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      setSpeed(speed + (e.key === "ArrowUp" ? 1 : -1));
      poke();
      return true;
    }
    if (e.key === "Escape") {
      if (spot) setSpot(null);
      else if (panel) setPanel(false);
      else exit();
      return true;
    }
    return false;
  });

  // Touching the chart pauses at once. A tap (no drag) plays again; a drag stays paused.
  const wasPlaying = useRef(false);
  const closedPanel = useRef(false);
  // Press and hold a chord: opens the sheet over stage mode. A hold is never a tap or a swipe.
  const hold = useHold(s.view, s.chords, setSpot);
  const marks = useHoldMarks(slug, s.view, spot);
  const tapSwipe = useGesture({
    onDown: () => {
      wasPlaying.current = playing;
      closedPanel.current = panel;
      if (panel) setPanel(false);
      if (playing) setPlaying(false);
      poke();
    },
    onTap: () => {
      if (!hold.held() && !wasPlaying.current && !closedPanel.current) play();
    },
    onSwipe: (d) => !hold.held() && go(d),
  });
  const gesture = withHold(tapSwipe, hold.handlers);

  if (!s.view) {
    return (
      <div className={`fixed inset-0 grid place-items-center bg-bb-house-black p-6 text-center ${stageLook(theme === "light")}`}>
        <p className="text-xl">This chart has a format error.</p>
      </div>
    );
  }
  const view = s.view;
  const light = theme === "light";
  const blurButtons = () => {
    const a = document.activeElement;
    if (a instanceof HTMLButtonElement) a.blur(); // so Space never double-fires a focused button
  };

  return (
    <div className={`fixed inset-0 z-50 flex flex-col bg-bb-house-black text-bb-chart-white ${stageLook(light)}`} onPointerDownCapture={poke}>
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-bb-rule-gray/60 pl-1 pr-2 text-base">
        <button onClick={exit} aria-label={set ? "Exit play mode" : "Exit stage mode"} className="grid size-11 shrink-0 place-items-center rounded-lg text-2xl text-bb-cue-gray active:bg-bb-case-charcoal">
          ✕
        </button>
        <div className="flex min-w-20 flex-1 items-baseline gap-1">
          <b className="truncate">{title}</b>
          {view.keyShort && <span className="shrink-0 whitespace-nowrap text-bb-cue-gray">· {pretty(view.keyShort)}</span>}
        </div>
        {pick.mine && (
          <button
            onClick={() => pick.setShowPublic(pick.usingMine)}
            aria-label={pick.usingMine ? "Showing your version. Tap to view the public version" : "Showing the public version. Tap to view yours"}
            className={`h-11 shrink-0 self-center rounded-md px-1 text-[0.7rem] font-bold uppercase ${pick.usingMine ? "text-violet-300" : "text-bb-cue-gray"}`}
          >
            {pick.usingMine ? "Yours" : "Public"}
          </button>
        )}
        <BpmToggle s={s} className="shrink-0 text-sm text-bb-cue-gray" />
        {set ? (
          <>
            <button onClick={set.onJump} aria-label="Jump to a song in the set" className="grid size-11 shrink-0 place-items-center rounded-lg text-bb-cue-gray active:bg-bb-case-charcoal">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
              </svg>
            </button>
          </>
        ) : (
          nav.next && (
            <button onClick={() => go(1)} className="h-11 min-w-0 max-w-[36%] shrink truncate text-right text-sm text-bb-cue-gray">
              Next: <span className="text-bb-chart-white">{nav.next.title}</span> ›
            </button>
          )
        )}
      </header>
      {set && (
        <button onClick={() => go(1)} className="flex h-10 shrink-0 items-center gap-2 border-b border-bb-rule-gray/60 px-3 text-left text-base text-bb-cue-gray">
          <span className="shrink-0 font-bold tabular-nums text-bb-chart-white">{set.count}</span>
          <span aria-hidden>·</span>
          {set.next ? (
            <span className="min-w-0 truncate">
              Next: <span className="font-semibold text-bb-chart-white">{set.next}</span> ›
            </span>
          ) : (
            <span className="font-semibold text-bb-chart-white">Last song</span>
          )}
        </button>
      )}
      {set?.note && <p className="shrink-0 truncate border-b border-bb-downbeat-amber/40 bg-bb-downbeat-amber/15 px-4 py-1.5 text-xl font-bold text-bb-downbeat-amber">{set.note}</p>}

      <div
        ref={scroller}
        {...gesture}
        onWheel={() => playing && setPlaying(false)}
        className="relative min-h-0 flex-1 touch-pan-y select-none overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-2"
      >
        <Chart rootRef={chartEl} view={view} chords={s.chords} fontFamily={FONTS[s.font].css} fontWeight={FONTS[s.font].weight} style={{ fontSize: fontPx }} hold={marks} />
        {scrollable && <div className="h-32" aria-hidden />}
      </div>

      {spot && <HoldSheet slug={slug} spot={spot} onMine={pick.usingMine} onClose={() => setSpot(null)} onSwipe={(d) => go(d)} />}

      {toast && (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-20 text-center">
          <span className="rounded-full bg-bb-case-charcoal px-4 py-2 text-lg">{toast}</span>
        </div>
      )}

      <div
        onClick={blurButtons}
        className={`absolute inset-x-0 bottom-0 z-10 transition-opacity duration-300 ${shown ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        {panel && (
          <div className="mx-2 mb-2 max-h-[65dvh] overflow-y-auto rounded-2xl border border-bb-rule-gray bg-bb-case-charcoal p-4 shadow-2xl">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <DisplayControls s={s} />
            </div>
            <div className="mb-1 flex items-center justify-between text-lg">
              <label htmlFor="stage-size">Text size</label>
              <span className="text-bb-cue-gray">{manual ? `${fontPx}px` : `Auto · ${fontPx}px`}</span>
            </div>
            <div className="mb-4 flex items-center gap-2">
              <input
                id="stage-size"
                type="range"
                min={16}
                max={Math.min(fitW ?? MAX_STAGE_SIZE, MAX_STAGE_SIZE)}
                step={1}
                value={fontPx}
                onChange={(e) => setPref(PREF.size, e.target.value)}
                className="h-11 min-w-0 flex-1 accent-amber-400"
              />
              <button className={`${btn} ${manual ? on : off} shrink-0 text-base`} onClick={() => setPref(PREF.size, null)} disabled={!manual}>
                {manual ? "Reset" : "Auto"}
              </button>
            </div>
            <p className="mb-1 text-lg">Font</p>
            <div className="mb-4 grid grid-cols-2 gap-2" role="group" aria-label="Font">
              {(Object.keys(FONTS) as FontId[]).map((f) => (
                <button
                  key={f}
                  onClick={() => s.setFont(f)}
                  aria-pressed={s.font === f}
                  className={`${btn} px-1 ${s.font === f ? on : off}`}
                  style={{ fontFamily: FONTS[f].css, fontWeight: FONTS[f].weight }}
                >
                  {FONTS[f].label}
                </button>
              ))}
            </div>
            <p className="mb-1 text-lg">Screen</p>
            <div className="mb-4 grid grid-cols-2 gap-2" role="group" aria-label="Screen">
              {(["dark", "light"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setPref(PREF.stageTheme, t === "light" ? "light" : null)}
                  aria-pressed={light === (t === "light")}
                  className={`${btn} ${light === (t === "light") ? on : off}`}
                >
                  {t === "light" ? "Light" : "Dark"}
                </button>
              ))}
            </div>
            <button className={`${btn} ${off} w-full`} onClick={() => setPanel(false)}>
              Done
            </button>
          </div>
        )}

        <div
          className={`flex flex-col gap-1 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 ${
            scrollable || panel ? "border-t border-bb-rule-gray/60 bg-bb-house-black/90 backdrop-blur" : "pointer-events-none [&_button]:pointer-events-auto"
          }`}
        >
          <div className="flex items-center gap-1.5">
            {scrollable && (
              <>
                <button
                  onClick={() => (playing ? setPlaying(false) : play())}
                  aria-label={playing ? "Pause scrolling" : "Play scrolling"}
                  className="grid h-12 w-14 shrink-0 place-items-center rounded-lg bg-bb-downbeat-amber text-2xl text-bb-stage-black"
                >
                  {playing ? "❚❚" : "▶"}
                </button>
                <button onClick={() => setSpeed(speed - 1)} aria-label="Slower" className={`${btn} ${off} shrink-0 px-0 text-2xl`}>
                  −
                </button>
                <span className="w-9 shrink-0 text-center text-2xl font-bold tabular-nums" aria-live="polite" aria-label={`Speed ${speed}`}>
                  {speed}
                </span>
                <button onClick={() => setSpeed(speed + 1)} aria-label="Faster" className={`${btn} ${off} shrink-0 px-0 text-2xl`}>
                  +
                </button>
                <button
                  onClick={() => setPref(PREF.songSpeed(slug), songSpeed === null ? String(speed) : null)}
                  aria-pressed={songSpeed !== null}
                  title="Remember this speed for this song"
                  className={`h-12 min-w-11 shrink rounded-lg px-2 text-sm font-semibold leading-tight ${songSpeed !== null ? on : off}`}
                >
                  {songSpeed !== null ? "Song ✓" : "Save song"}
                </button>
              </>
            )}
            <button
              onClick={() => setPanel(!panel)}
              aria-expanded={panel}
              aria-label="Text size, font and display"
              className={`${btn} ${panel ? on : off} ml-auto shrink-0 px-3`}
            >
              Aa
            </button>
          </div>
          {scrollable && (
            <div className="flex items-center gap-2">
              <label htmlFor="stage-speed" className="text-sm text-bb-cue-gray">
                Speed
              </label>
              <input
                id="stage-speed"
                type="range"
                min={1}
                max={MAX_SPEED}
                step={1}
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="h-10 min-w-0 flex-1 accent-amber-400"
              />
              {suggested && suggested !== speed && (
                <button onClick={() => setSpeed(suggested)} className="h-10 shrink-0 rounded-lg px-2 text-sm text-bb-cue-gray underline">
                  Suggested {suggested}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
