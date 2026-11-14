"use client";

import { useEffect, useMemo, useRef } from "react";
import { buildView, parseChart, type MinorSymbol, type NumberStyle } from "@/lib/chart";
import { PREF, setPref, usePref } from "@/lib/prefs";

export interface SongLink {
  slug: string;
  title: string;
}
export interface Neighbors {
  prev: SongLink | null;
  next: SongLink | null;
}

export const FONTS = {
  atkinson: { label: "Legible", css: "var(--bb-font-chart)", weight: 700 },
  inter: { label: "Sans", css: "var(--font-inter), system-ui, sans-serif", weight: 700 },
  mono: { label: "Mono", css: "var(--font-jbmono), ui-monospace, monospace", weight: 700 },
  heavy: { label: "Bold", css: "var(--font-inter), system-ui, sans-serif", weight: 900 },
} as const;
export type FontId = keyof typeof FONTS;

/** Key held by the caller instead of the per-song device pref (setlist play mode: session only). */
export interface KeyControl {
  key: string | null;
  setKey: (k: string | null) => void;
}

/** Parsed chart + the player's display choices (remembered per device / per song). */
export function useChartState(slug: string, chartText: string, keyCtl?: KeyControl) {
  const parsed = useMemo(() => {
    try {
      return { doc: parseChart(chartText).doc, error: null };
    } catch (e) {
      return { doc: null, error: (e as Error).message };
    }
  }, [chartText]);

  const chords = usePref(PREF.display) === "chords";
  const devicePref = usePref(PREF.key(slug));
  const keyPref = keyCtl ? keyCtl.key : devicePref;
  const stylePref = usePref(PREF.numbering(slug));
  const style: NumberStyle | undefined = stylePref === "minor" || stylePref === "relative" ? stylePref : undefined;
  const minorSymbol: MinorSymbol = usePref(PREF.minorSymbol) === "-" ? "-" : "m";
  const legend = usePref(PREF.legend) === "1";
  const fontPref = usePref(PREF.font);
  const font: FontId = fontPref && fontPref in FONTS ? (fontPref as FontId) : "atkinson";
  const pulse = usePref(PREF.pulse) === "1";

  const view = useMemo(
    () => (parsed.doc ? buildView(parsed.doc, { key: keyPref, style, minorSymbol }) : null),
    [parsed.doc, keyPref, style, minorSymbol],
  );

  return {
    view,
    error: parsed.error,
    chords,
    font,
    pulse,
    minorSymbol,
    legend,
    setChords: (on: boolean) => setPref(PREF.display, on ? "chords" : "numbers"),
    setKey: (k: string) => (keyCtl ? keyCtl.setKey(k) : setPref(PREF.key(slug), view && k === view.meta.key ? null : k)),
    // Per song. Choosing the chart's own numbering clears the override.
    setStyle: (st: NumberStyle) => setPref(PREF.numbering(slug), view && st === view.meta.numbers ? null : st),
    setMinorSymbol: (m: MinorSymbol) => setPref(PREF.minorSymbol, m),
    setLegend: (open: boolean) => setPref(PREF.legend, open ? "1" : null),
    setFont: (f: FontId) => setPref(PREF.font, f),
    setPulse: (on: boolean) => setPref(PREF.pulse, on ? "1" : null),
  };
}
export type ChartState = ReturnType<typeof useChartState>;

/** Previous/next song: the list the player opened this song from, else alphabetical. */
export function useSongNav(slug: string, fallback: Neighbors): Neighbors {
  const raw = usePref(PREF.nav, "session");
  return useMemo(() => {
    if (raw) {
      try {
        const list = JSON.parse(raw) as SongLink[];
        const i = list.findIndex((s) => s.slug === slug);
        if (i >= 0) return { prev: list[i - 1] ?? null, next: list[i + 1] ?? null };
      } catch {
        // bad data: fall through
      }
    }
    return fallback;
  }, [raw, slug, fallback]);
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName));

/** Arrow keys and PageUp/PageDown (page-turner pedals) move between songs. */
export function useSongKeys(go: (dir: -1 | 1) => void, extra?: (e: KeyboardEvent) => boolean) {
  const ref = useRef({ go, extra });
  useEffect(() => {
    ref.current = { go, extra };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (ref.current.extra?.(e)) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        ref.current.go(1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        ref.current.go(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export interface Gesture {
  onSwipe: (dir: -1 | 1) => void; // swipe left = next (+1)
  onTap?: () => void;
  onDown?: () => void;
}

/** Pointer handlers: horizontal swipe -> song change, short still press -> tap. */
export function useGesture({ onSwipe, onTap, onDown }: Gesture) {
  const start = useRef<{ x: number; y: number; t: number; id: number } | null>(null);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      start.current = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
      // Touch already keeps the pointer here; do the same for mouse/pen so the release still
      // counts as a tap when controls pop up under the cursor on press.
      if (e.pointerType !== "touch") e.currentTarget.setPointerCapture?.(e.pointerId);
      onDown?.();
    },
    onPointerUp: (e: React.PointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s || s.id !== e.pointerId) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) onSwipe(dx < 0 ? 1 : -1);
      else if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && performance.now() - s.t < 500) onTap?.();
    },
    onPointerCancel: () => {
      start.current = null;
    },
  };
}
