"use client";

import { useMemo } from "react";
import type { ChartView } from "@/lib/chart";
import { roadMap } from "@/lib/chart/roadmap";

/** One thin line with the song's order ("I V C V C B C×2 O") above the Whole song view.
 *  `current` (a section index) is lit when something knows where the band is. */
export default function RoadMap({ view, current = null, className = "" }: { view: ChartView; current?: number | null; className?: string }) {
  const stops = useMemo(() => roadMap(view), [view]);
  if (stops.length < 2) return null;
  return (
    <p aria-label="Song order" className={`flex h-8 shrink-0 items-center gap-[0.6em] overflow-hidden whitespace-nowrap font-bb-data text-base font-bold text-bb-cue-gray ${className}`}>
      {stops.map((s, i) => (
        <span key={i} className={i === current ? "text-bb-downbeat-amber" : undefined}>
          {s.label}
          {s.repeat > 1 && <span className="font-normal">×{s.repeat}</span>}
        </span>
      ))}
    </p>
  );
}
