"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useRef } from "react";
import type { SongDoc } from "@/lib/search/pack";

function enterFullscreen() {
  try {
    document.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {});
  } catch {
    // not supported (iPhone Safari): stage mode still works
  }
}

const LONG_PRESS_MS = 500;

/** One search result. Tap = chart, long-press or the stage button = straight into stage mode. */
function SongRow({ d, index, onOpen }: { d: SongDoc; index: number; onOpen: () => void }) {
  const router = useRouter();
  const stage = `/songs/${d.slug}/stage`;
  const timer = useRef<number | undefined>(undefined);
  const fired = useRef(false);
  const start = useRef({ x: 0, y: 0 });
  const cancel = () => window.clearTimeout(timer.current);
  const meta = [d.bpm && `${d.bpm} bpm`, d.time, d.feel].filter(Boolean).join(" · ");

  return (
    <li id={`r${index}`} className="flex scroll-mt-20 items-stretch bg-panel">
      <Link
        href={`/songs/${d.slug}`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          fired.current = false;
          start.current = { x: e.clientX, y: e.clientY };
          cancel();
          timer.current = window.setTimeout(() => {
            fired.current = true;
            navigator.vibrate?.(20);
            onOpen();
            enterFullscreen();
            router.push(stage);
          }, LONG_PRESS_MS);
        }}
        onPointerMove={(e) => {
          if (Math.abs(e.clientX - start.current.x) + Math.abs(e.clientY - start.current.y) > 12) cancel();
        }}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onContextMenu={(e) => e.preventDefault()}
        onClick={(e) => {
          if (fired.current) {
            e.preventDefault();
            fired.current = false;
            return;
          }
          onOpen();
        }}
        className="flex min-h-16 min-w-0 flex-1 select-none items-center justify-between gap-3 py-3 pl-4 pr-2 [-webkit-touch-callout:none] active:bg-line"
      >
        <span className="min-w-0">
          <span className="block truncate text-xl font-semibold">{d.title}</span>
          <span className="block truncate text-muted">
            {d.artist}
            {meta && (
              <span className="text-sm">
                {d.artist ? " · " : ""}
                {meta}
              </span>
            )}
            {d.ex && (
              <span className="ml-2 rounded bg-accent/20 px-1.5 py-0.5 text-xs font-semibold uppercase text-accent">
                Example
              </span>
            )}
          </span>
        </span>
        {d.key && <span className="shrink-0 font-mono text-2xl font-bold text-accent">{d.key}</span>}
      </Link>
      <Link
        href={stage}
        onClick={() => {
          onOpen();
          enterFullscreen();
        }}
        aria-label={`Open ${d.title} in stage mode`}
        title="Stage mode"
        className="flex w-14 shrink-0 items-center justify-center border-l border-line text-muted active:bg-line active:text-accent"
      >
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
    </li>
  );
}

export default memo(SongRow);
