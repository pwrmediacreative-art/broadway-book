"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

// The original handwritten chart, drawn with pdf.js so every page shows and zooms on
// phones too (an <iframe> shows only page 1 on iPhones). Pinch, ⌘/Ctrl + scroll, or
// the − / + buttons zoom; the zoom is remembered on this device.

const MIN = 1;
const MAX = 4;
const MAX_FIT = 1600; // px: the "100%" page width never exceeds this
const ZOOM_KEY = "bb_review_zoom";
const clamp = (z: number) => Math.min(MAX, Math.max(MIN, Math.round(z * 100) / 100));
const btn = "min-h-11 min-w-11 rounded-lg border border-line px-3 text-lg font-semibold active:bg-line disabled:opacity-40";

function savedZoom() {
  try {
    const z = Number(localStorage.getItem(ZOOM_KEY));
    return z >= MIN && z <= MAX ? z : 1;
  } catch {
    return 1;
  }
}

export default function PdfViewer({ src, title }: { src: string; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [zoom, setZoomState] = useState(1);
  const [width, setWidth] = useState(0);
  const zoomRef = useRef(1);

  const setZoom = (z: number) => {
    const next = clamp(z);
    zoomRef.current = next;
    setZoomState(next);
    try {
      localStorage.setItem(ZOOM_KEY, String(next));
    } catch {
      /* private mode */
    }
  };

  useEffect(() => {
    const z = savedZoom();
    zoomRef.current = z;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of browser-only state
    setZoomState(z);
  }, []);

  useEffect(() => {
    let dead = false;
    let destroy: (() => void) | null = null;
    (async () => {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
      const task = pdfjs.getDocument({ url: src, withCredentials: true });
      destroy = () => void task.destroy();
      const d = await task.promise;
      if (dead) return;
      setDoc(d);
    })().catch((e: unknown) => {
      if (!dead) setErr(e instanceof Error ? e.message : "Couldn't open the PDF");
    });
    return () => {
      dead = true;
      destroy?.();
    };
  }, [src]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // The box can't grow with its content (min-w-0 up the tree), so this is the pane width.
    const measure = () => setWidth(Math.min(el.clientWidth, MAX_FIT));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  // Trackpad pinch and ⌘/Ctrl + scroll arrive as wheel events with ctrlKey/metaKey.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setZoom(zoomRef.current * Math.exp(-e.deltaY / 200));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Two-finger pinch on touch screens: scale with CSS while pinching, redraw at the end.
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d0: number; z0: number; ratio: number } | null>(null);
  const dist = () => {
    const [a, b] = [...touches.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.current.size === 2) pinch.current = { d0: dist(), z0: zoomRef.current, ratio: 1 };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!touches.current.has(e.pointerId)) return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = pinch.current;
    if (p && touches.current.size === 2 && inner.current) {
      p.ratio = clamp(p.z0 * (dist() / p.d0)) / p.z0;
      inner.current.style.transform = `scale(${p.ratio})`;
    }
  };
  const onPointerEnd = (e: React.PointerEvent) => {
    touches.current.delete(e.pointerId);
    const p = pinch.current;
    if (p && touches.current.size < 2) {
      pinch.current = null;
      if (inner.current) inner.current.style.transform = "";
      setZoom(p.z0 * p.ratio);
    }
  };

  const pageWidth = Math.max(0, Math.floor(width * zoom) - 2);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Zoom the original">
        <button type="button" className={btn} onClick={() => setZoom(zoom - 0.25)} disabled={zoom <= MIN} aria-label="Zoom out">
          −
        </button>
        <span className="min-w-14 text-center text-lg tabular-nums text-muted">{Math.round(zoom * 100)}%</span>
        <button type="button" className={btn} onClick={() => setZoom(zoom + 0.25)} disabled={zoom >= MAX} aria-label="Zoom in">
          +
        </button>
        <button type="button" className={btn} onClick={() => setZoom(1)} disabled={zoom === 1}>
          Fit
        </button>
        <a href={src.replace("?inline=1", "")} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex min-h-11 items-center px-2 text-lg text-accent">
          Open PDF ↗
        </a>
      </div>
      <div
        ref={box}
        className="min-h-0 w-full min-w-0 flex-1 overflow-auto rounded-lg bg-neutral-700"
        style={{ touchAction: "pan-x pan-y" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        aria-label={`Original chart: ${title}`}
        role="region"
      >
        <div ref={inner} className="flex flex-col gap-2 p-px" style={{ transformOrigin: "0 0", width: pageWidth || undefined }}>
          {err && <p className="p-4 text-lg text-red-200">Couldn&apos;t show the PDF: {err}</p>}
          {!doc && !err && <p className="p-4 text-lg text-neutral-200">Loading the original…</p>}
          {doc && pageWidth > 0 &&
            Array.from({ length: doc.numPages }, (_, i) => <Page key={i} doc={doc} n={i + 1} width={pageWidth} />)}
        </div>
      </div>
    </div>
  );
}

function Page({ doc, n, width }: { doc: PDFDocumentProxy; n: number; width: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [height, setHeight] = useState(Math.round(width * 1.3));

  useEffect(() => {
    let cancel: (() => void) | null = null;
    let dead = false;
    (async () => {
      const page = await doc.getPage(n);
      if (dead || !canvas.current) return;
      const base = page.getViewport({ scale: 1 });
      const scale = width / base.width;
      // Sharp on retina, but keep the canvas under ~16M pixels (iOS Safari's limit).
      const maxPx = 16_000_000;
      let dpr = Math.min(window.devicePixelRatio || 1, 3);
      while (dpr > 1 && base.width * scale * dpr * base.height * scale * dpr > maxPx) dpr -= 0.5;
      const vp = page.getViewport({ scale: scale * dpr });
      const c = canvas.current;
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      setHeight(Math.round(vp.height / dpr));
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const task = page.render({ canvasContext: ctx, viewport: vp });
      cancel = () => task.cancel();
      await task.promise.catch(() => {});
    })().catch(() => {});
    return () => {
      dead = true;
      cancel?.();
    };
  }, [doc, n, width]);

  return <canvas ref={canvas} className="block bg-white" style={{ width, height }} aria-label={`Page ${n}`} />;
}
