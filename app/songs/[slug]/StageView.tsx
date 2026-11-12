"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { pretty, SPEEDS, suggestSpeed } from "@/lib/chart";
import { PREF, setPref, usePref } from "@/lib/prefs";
import Chart from "./Chart";
import { btn, BpmToggle, DisplayControls, off, on } from "./controls";
import { FONTS, useChartState, useGesture, useSongKeys, useSongNav, type FontId, type Neighbors } from "./hooks";

const FIT_MIN = 30; // px: smallest size we shrink to so the whole chart fits without scrolling
const SCROLL_SIZE = 40; // px: size used when it can't fit and has to scroll (if the width allows)
const MAX_SIZE = 160;
const PAD_Y = 16; // scroller py-2
const HIDE_MS = 3500;
const clampSpeed = (n: number) => Math.min(SPEEDS.length, Math.max(1, Math.round(n)));
// Stage-only colors: dark (default) is pure black; light is a high-contrast paper look.
const DARK = { "--background": "#000" } as CSSProperties;
const LIGHT = {
  "--background": "#ffffff",
  "--foreground": "#0a0a0b",
  "--muted": "#44403c",
  "--accent": "#b45309",
  "--panel": "#f5f5f4",
  "--line": "#a8a29e",
  "--chg": "#0369a1",
  colorScheme: "light",
} as CSSProperties;
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

export default function StageView({ slug, title, chartText, neighbors }: { slug: string; title: string; chartText: string; neighbors: Neighbors }) {
  const s = useChartState(slug, chartText);
  const nav = useSongNav(slug, neighbors);
  const router = useRouter();
  const scroller = useRef<HTMLDivElement>(null);
  const chartEl = useRef<HTMLDivElement>(null);
  useWakeLock();
  const theme = usePref(PREF.stageTheme);

  // --- text size: auto-fit unless the player set one -------------------------------------
  const manual = num(usePref(PREF.size));
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
    const wFit = Math.floor(search(10, MAX_SIZE, fitsW));
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

  const songSpeed = num(usePref(PREF.songSpeed(slug)));
  const deviceSpeed = num(usePref(PREF.speed));
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
  const go = (d: -1 | 1) => {
    const t = d > 0 ? nav.next : nav.prev;
    if (t) router.push(`/songs/${t.slug}/stage`);
    else setToast(d > 0 ? "Last song in the list" : "First song in the list");
  };
  const exit = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    router.push(`/songs/${slug}`);
  };
  useEffect(() => {
    if (nav.next) router.prefetch(`/songs/${nav.next.slug}/stage`);
  }, [nav.next, router]);

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
      if (panel) setPanel(false);
      else exit();
      return true;
    }
    return false;
  });

  // Touching the chart pauses at once. A tap (no drag) plays again; a drag stays paused.
  const wasPlaying = useRef(false);
  const closedPanel = useRef(false);
  const gesture = useGesture({
    onDown: () => {
      wasPlaying.current = playing;
      closedPanel.current = panel;
      if (panel) setPanel(false);
      if (playing) setPlaying(false);
      poke();
    },
    onTap: () => {
      if (!wasPlaying.current && !closedPanel.current) play();
    },
    onSwipe: go,
  });

  if (!s.view) {
    return (
      <div className="fixed inset-0 grid place-items-center bg-background p-6 text-center" style={theme === "light" ? LIGHT : DARK}>
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
    <div className="fixed inset-0 z-50 flex flex-col bg-background text-foreground" style={light ? LIGHT : DARK} onPointerDownCapture={poke}>
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line/60 pl-1 pr-2 text-base">
        <button onClick={exit} aria-label="Exit stage mode" className="grid size-11 shrink-0 place-items-center rounded-lg text-2xl text-muted active:bg-panel">
          ✕
        </button>
        <div className="flex min-w-0 flex-1 items-baseline gap-1">
          <b className="truncate">{title}</b>
          {view.keyShort && <span className="shrink-0 whitespace-nowrap text-muted">· {pretty(view.keyShort)}</span>}
        </div>
        <BpmToggle s={s} className="shrink-0 text-sm text-muted" />
        {nav.next && (
          <button onClick={() => go(1)} className="h-11 min-w-0 max-w-[36%] shrink truncate text-right text-sm text-muted">
            Next: <span className="text-foreground">{nav.next.title}</span> ›
          </button>
        )}
      </header>

      <div
        ref={scroller}
        {...gesture}
        onWheel={() => playing && setPlaying(false)}
        className="relative min-h-0 flex-1 touch-pan-y select-none overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-2"
      >
        <Chart rootRef={chartEl} view={view} chords={s.chords} fontFamily={FONTS[s.font].css} fontWeight={FONTS[s.font].weight} style={{ fontSize: fontPx }} />
        {scrollable && <div className="h-32" aria-hidden />}
      </div>

      {toast && (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-20 text-center">
          <span className="rounded-full bg-panel px-4 py-2 text-lg">{toast}</span>
        </div>
      )}

      <div
        onClick={blurButtons}
        className={`absolute inset-x-0 bottom-0 z-10 transition-opacity duration-300 ${shown ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        {panel && (
          <div className="mx-2 mb-2 max-h-[65dvh] overflow-y-auto rounded-2xl border border-line bg-panel p-4 shadow-2xl">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <DisplayControls s={s} />
            </div>
            <div className="mb-1 flex items-center justify-between text-lg">
              <label htmlFor="stage-size">Text size</label>
              <span className="text-muted">{manual ? `${fontPx}px` : `Auto · ${fontPx}px`}</span>
            </div>
            <div className="mb-4 flex items-center gap-2">
              <input
                id="stage-size"
                type="range"
                min={16}
                max={fitW ?? MAX_SIZE}
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
            scrollable || panel ? "border-t border-line/60 bg-background/90 backdrop-blur" : "pointer-events-none [&_button]:pointer-events-auto"
          }`}
        >
          <div className="flex items-center gap-1.5">
            {scrollable && (
              <>
                <button
                  onClick={() => (playing ? setPlaying(false) : play())}
                  aria-label={playing ? "Pause scrolling" : "Play scrolling"}
                  className="grid h-12 w-14 shrink-0 place-items-center rounded-lg bg-accent text-2xl text-black"
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
              <label htmlFor="stage-speed" className="text-sm text-muted">
                Speed
              </label>
              <input
                id="stage-speed"
                type="range"
                min={1}
                max={SPEEDS.length}
                step={1}
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="h-10 min-w-0 flex-1 accent-amber-400"
              />
              {suggested && suggested !== speed && (
                <button onClick={() => setSpeed(suggested)} className="h-10 shrink-0 rounded-lg px-2 text-sm text-muted underline">
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
