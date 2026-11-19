"use client";

// The top of a Full song chart, laid out like the paper charts players read (Q17): key, the
// time signature stacked (4 over 4) and the tempo top left, the title in the middle, the
// artist under it on the right. Fixed sizes, so the chart below can be fitted around it.
import type { ChartView } from "@/lib/chart";
import { pretty } from "@/lib/chart";

export default function PaperHead({
  view,
  title,
  artist,
  fontFamily,
  className = "",
}: {
  view: ChartView;
  title: string;
  artist?: string | null;
  fontFamily: string;
  className?: string;
}) {
  const { meta } = view;
  const time = meta.time?.match(/^(\d+)\/(\d+)$/);
  const by = artist ?? meta.artist;
  return (
    <header
      data-paper-head
      className={`grid shrink-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 [@media(max-height:30rem)]:grid-cols-[auto_minmax(0,1fr)_auto] font-bold leading-none text-bb-chart-white ${className}`}
      style={{ fontFamily }}
    >
      <div className="flex items-center gap-2 pt-0.5">
        {view.keyShort && (
          <span className="whitespace-nowrap text-2xl lg:text-4xl">
            <span className="sr-only">Key </span>
            {pretty(view.keyShort)}
          </span>
        )}
        {time ? (
          <span className="inline-flex flex-col items-center text-base leading-[0.95] lg:text-xl">
            <span className="sr-only">Time {meta.time}</span>
            <span aria-hidden>{time[1]}</span>
            <span aria-hidden>{time[2]}</span>
          </span>
        ) : (
          meta.time && <span className="text-base">{meta.time}</span>
        )}
        {meta.bpm && (
          <span className="inline-flex items-baseline gap-1 whitespace-nowrap text-base lg:text-xl">
            <span className="sr-only">Tempo </span>
            <span aria-hidden className="font-bb-data text-lg leading-none">
              ♩
            </span>
            <span aria-hidden>=</span>
            <span>{meta.bpm}</span>
          </span>
        )}
      </div>
      <h2 className="min-w-0 text-balance break-words text-center text-2xl leading-tight lg:text-4xl">{title}</h2>
      {/* Under the title on the right; beside it on short (landscape phone) screens. */}
      {by && (
        <p className="col-span-2 truncate text-right text-base font-semibold lg:text-xl text-bb-cue-gray [@media(max-height:30rem)]:col-span-1 [@media(max-height:30rem)]:max-w-[30vw] [@media(max-height:30rem)]:self-center">
          {by}
        </p>
      )}
    </header>
  );
}
