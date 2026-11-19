"use client";

// Full song (stage mode and the Full song pop-up, Q17; was Whole song, Q9): the whole chart on
// one screen, laid out like a paper chart (PaperHead on top). Sections flow top to bottom into
// as many columns as fit, left then right, and are never split; the text is as large as
// possible (up to the stage cap) while everything still fits. Below the smallest readable size
// it stops shrinking and turns into pages instead (columns that don't fit sit to the right).
// Never scrolls.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { ChartView } from "@/lib/chart";
import { MAX_STAGE_SIZE } from "@/lib/chart/layout";
import Chart, { type HoldMarks } from "./Chart";

export const FULL_MIN_DEFAULT = 24;
const GAP_EM = 1.2; // Chart's column gap
const FOOT = 28; // px kept free at the bottom for "Page 1 of 2" / "Next: …"

export interface Pager {
  /** Turn one page; false when already on the first/last page (the caller changes song). */
  turn: (d: -1 | 1) => boolean;
}

type Fit = { size: number; cols: number; pages: number; w: number };

export default function FullChart({
  view,
  chords,
  fontFamily,
  fontWeight,
  hold,
  minPx,
  next,
  pagerRef,
  head,
}: {
  view: ChartView;
  chords: boolean;
  fontFamily: string;
  fontWeight?: number;
  hold?: HoldMarks;
  minPx: number;
  next: string | null;
  pagerRef: RefObject<Pager | null>;
  /** Drawn above the columns (the paper header); the chart fits the space left under it. */
  head?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<Fit | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [pg, setPg] = useState<{ view: ChartView; page: number }>({ view, page: 0 });
  const page = pg.view === view && fit ? Math.min(pg.page, fit.pages - 1) : 0;

  // Re-fit when the box changes size (rotation, window resize, lyrics panel).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const r = root.current;
    const c = inner.current;
    const W = size.w;
    const H = size.h - FOOT;
    if (!r || !c || !W || H <= 0) return;
    const cap = Math.max(minPx, MAX_STAGE_SIZE);
    c.style.height = `${H}px`;
    const set = (px: number, cols: number) => {
      r.style.fontSize = `${px}px`;
      c.style.columnCount = String(cols);
    };
    const barsFit = () => [...c.querySelectorAll<HTMLElement>("[data-bar]")].every((x) => x.scrollWidth <= x.clientWidth + 1);
    const onePage = () => c.scrollWidth <= c.clientWidth + 1;
    const maxCols = (px: number) => Math.min(6, Math.max(1, Math.floor(W / (px * 7))));
    // The most columns that keep every bar whole on one page at this size; 0 = none does.
    const colsThatFit = (px: number) => {
      for (let n = maxCols(px); n >= 1; n--) {
        set(px, n);
        if (barsFit() && onePage()) return n;
      }
      return 0;
    };
    let px: number;
    let cols = colsThatFit(cap);
    if (cols) px = cap;
    else if (!colsThatFit(minPx)) {
      // Doesn't fit even at the smallest readable size: keep that size and turn pages.
      px = minPx;
      cols = 1;
      for (let n = maxCols(px); n >= 1; n--) {
        set(px, n);
        if (barsFit()) {
          cols = n;
          break;
        }
      }
    } else {
      let lo = minPx;
      let hi = cap;
      while (hi - lo > 0.5) {
        const m = (lo + hi) / 2;
        if (colsThatFit(m)) lo = m;
        else hi = m;
      }
      px = Math.floor(lo);
      cols = colsThatFit(px) || 1;
    }
    set(px, cols);
    const gap = GAP_EM * px;
    const pages = Math.max(1, Math.ceil((c.scrollWidth + gap - 1) / (W + gap)));
    setFit({ size: px, cols, pages, w: W });
  }, [view, chords, fontFamily, fontWeight, minPx, size]);

  // Page turns for keys, pedals, swipes and edge taps (StageView asks before changing song).
  // Reads refs, so two quick presses in one frame both count.
  const live = useRef({ fit, page, view });
  useLayoutEffect(() => {
    live.current = { fit, page, view };
  });
  useLayoutEffect(() => {
    pagerRef.current = {
      turn: (d) => {
        const { fit: f, page: p, view: v } = live.current;
        if (!f) return true; // still measuring: swallow the press instead of skipping the song
        const to = p + d;
        if (to < 0 || to >= f.pages) return false;
        live.current = { fit: f, page: to, view: v };
        setPg({ view: v, page: to });
        return true;
      },
    };
    return () => {
      pagerRef.current = null;
    };
  }, [pagerRef]);

  const shift = fit ? page * (fit.w + GAP_EM * fit.size) : 0;
  const last = fit ? page === fit.pages - 1 : true;
  return (
    <div className="flex h-full w-full flex-col">
    {head}
    <div ref={box} className="relative min-h-0 w-full flex-1 overflow-hidden">
      <div style={{ transform: `translateX(${-shift}px)` }}>
        <Chart
          rootRef={root}
          view={view}
          chords={chords}
          fontFamily={fontFamily}
          fontWeight={fontWeight}
          style={{ fontSize: fit?.size ?? minPx }}
          hold={hold}
          columns={{ count: fit?.cols ?? 1, height: size.h > FOOT ? size.h - FOOT : undefined, innerRef: inner }}
          paper
        />
      </div>
      {fit && (fit.pages > 1 || next) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 text-base text-bb-cue-gray">
          <span className="bg-bb-house-black px-1">{fit.pages > 1 ? `Page ${page + 1} of ${fit.pages}` : ""}</span>
          {last && next && (
            <span className="min-w-0 truncate bg-bb-house-black px-1">
              Next: <span className="text-bb-chart-white">{next}</span> ›
            </span>
          )}
        </div>
      )}
    </div>
    </div>
  );
}
