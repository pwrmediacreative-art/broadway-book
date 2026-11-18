"use client";

import type { CSSProperties, Ref } from "react";
import {
  barScale,
  layoutRow,
  pretty,
  splitQuality,
  type BarCell,
  type BeatView,
  type ChartView,
  type GridLine,
  type Hairpin,
  type Note,
} from "@/lib/chart";

// Every size below is in em, relative to the chart's font size, so the whole chart
// scales together (song page: fixed size; stage mode: auto-fit or the player's size).

export function Caret({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 20 12" className={className} aria-hidden>
      <polyline points="2,11 10,2 18,11" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Fermata({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 14" className={className} aria-hidden>
      <path d="M2 13 A10 10 0 0 1 22 13" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="12" cy="10" r="2.4" fill="currentColor" />
    </svg>
  );
}

function Name({ b, chords }: { b: BeatView; chords: boolean }) {
  const p = chords ? b.c : b.n;
  if (b.kind === "repeat") return <span className="text-bb-chart-white/85">%</span>;
  if (b.kind === "nc") return <span className="text-[0.8em]">N.C.</span>;
  const [inline, sup] = splitQuality(p.qual);
  return (
    <>
      <span>
        {pretty(p.root)}
        {inline}
      </span>
      {sup && <sup className="ml-[0.03em] text-[0.6em]">{pretty(sup)}</sup>}
      {p.bass && <span className="text-[0.8em]">/{pretty(p.bass)}</span>}
    </>
  );
}

/** Long-press support (song page + stage): which beats carry a personal flag, which one is held. */
export interface HoldMarks {
  flagged: Set<string>; // "section.bar.beat" (lib/flags/ref refKey)
  selected: string | null;
}
type BeatSpot = { id: string; hold: HoldMarks } | null;

function Beat({ b, chords, marks, spot }: { b: BeatView; chords: boolean; marks: boolean; spot?: BeatSpot }) {
  const selected = spot && spot.hold.selected === spot.id;
  return (
    <span
      data-beat={spot?.id}
      className={`relative inline-flex flex-col items-start px-[0.1em] ${
        spot ? "select-none [-webkit-touch-callout:none]" : ""
      } ${selected ? "rounded-[0.12em] bg-bb-downbeat-amber/25 outline outline-[0.06em] outline-bb-downbeat-amber" : ""}`}
    >
      {spot?.hold.flagged.has(spot.id) && (
        <span className="bb-dot bb-dot-flag absolute right-0 top-0 size-[0.24em]" aria-label="flagged" role="img" />
      )}
      {marks && (
        <span className="relative h-[0.42em] w-full min-w-[0.5em]" aria-hidden>
          {b.push && <Caret className="absolute bottom-0 left-0 h-[0.36em] w-[0.55em] text-bb-downbeat-amber" />}
          {b.end === "fermata" && (
            <Fermata className="absolute bottom-0 left-1/2 h-[0.4em] w-[0.75em] -translate-x-1/2 text-bb-downbeat-amber" />
          )}
          {b.end === "stop" && (
            <span className="bb-dot absolute bottom-[0.04em] right-0 size-[0.28em] bg-bb-chart-stop-red" />
          )}
        </span>
      )}
      <span className={`relative inline-flex items-baseline whitespace-nowrap ${b.diamond ? "px-[0.34em] py-[0.18em]" : ""}`}>
        {b.diamond && (
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
            <polygon points="50,3 97,50 50,97 3,50" fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          </svg>
        )}
        <span className="sr-only">
          {[b.push && "push", b.diamond && "diamond", b.end === "stop" && "stop", b.end === "fermata" && "hold"]
            .filter(Boolean)
            .join(" ")}{" "}
        </span>
        <Name b={b} chords={chords} />
      </span>
    </span>
  );
}

function Bar({ cell, chords, marks, spot }: { cell: BarCell; chords: boolean; marks: boolean; spot?: { id: string; hold: HoldMarks } | null }) {
  const beats = cell.beats.map((b, i) => (
    <span key={i} className={i ? "border-l-[0.05em] border-bb-chart-white/45" : ""}>
      <Beat b={b} chords={chords} marks={marks} spot={spot && { id: `${spot.id}.${i}`, hold: spot.hold }} />
    </span>
  ));
  return (
    <div style={{ fontSize: `${barScale(cell, chords)}em` }}>
      {cell.beats.length === 1 ? (
        beats
      ) : (
        <span className="inline-flex items-end rounded-[0.14em] border-[0.06em] border-bb-chart-white/75 px-[0.06em]" title="Split bar">
          {beats}
        </span>
      )}
    </div>
  );
}

/** Repeat sign drawn on a bar's edge: |: before it, :| after it. */
function RepeatMark({ end }: { end: boolean }) {
  return (
    <svg viewBox="0 0 10 24" className="h-[0.95em] w-[0.42em] shrink-0 text-bb-chart-white" role="img" aria-label={end ? "end repeat" : "start repeat"}>
      {end ? (
        <>
          <circle cx="2" cy="9" r="1.7" fill="currentColor" />
          <circle cx="2" cy="15" r="1.7" fill="currentColor" />
          <rect x="5" y="1" width="1.2" height="22" fill="currentColor" />
          <rect x="7.5" y="1" width="2.5" height="22" fill="currentColor" />
        </>
      ) : (
        <>
          <rect x="0" y="1" width="2.5" height="22" fill="currentColor" />
          <rect x="3.8" y="1" width="1.2" height="22" fill="currentColor" />
          <circle cx="8" cy="9" r="1.7" fill="currentColor" />
          <circle cx="8" cy="15" r="1.7" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

function NoteChip({ n, chords }: { n: Note; chords?: boolean }) {
  if (n.kind === "box")
    return (
      <span className="border-[0.08em] border-bb-chart-white px-[0.4em] py-[0.15em] text-[0.45em] font-semibold leading-tight text-bb-chart-white">
        {pretty(n.text)}
        {chords && n.key ? ` → ${pretty(n.key)}` : ""}
      </span>
    );
  if (n.kind === "repeat") return <span className="text-[0.5em] font-semibold text-bb-chart-white">{n.text}</span>;
  if (n.kind === "change")
    return (
      <span className="rounded-[0.3em] border-[0.08em] border-bb-key-change-blue px-[0.4em] py-[0.12em] text-[0.45em] font-semibold leading-tight text-bb-key-change-blue">
        {pretty(n.text.replace(/^Key: /, "Key → "))}
      </span>
    );
  if (n.kind === "dynamic") return <span className="text-[0.45em] italic text-bb-cue-gray">{n.text}</span>;
  return <span className="text-[0.45em] font-semibold italic leading-tight text-bb-downbeat-amber">“{n.text}”</span>;
}

function Wedge({ h }: { h: Hairpin }) {
  const open = (t: number) => (h.dir === "cresc" ? t : 1 - t);
  const a = 5 * open(h.from);
  const b = 5 * open(h.to);
  return (
    <svg
      viewBox="0 0 100 10"
      preserveAspectRatio="none"
      className="h-[0.4em] w-full text-bb-cue-gray"
      style={{ gridColumn: `${h.col + 1} / span ${h.span}`, gridRow: 3 }}
      role="img"
      aria-label={h.dir === "cresc" ? "crescendo" : "decrescendo"}
    >
      <polyline points={`0,${5 - a} 100,${5 - b}`} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <polyline points={`0,${5 + a} 100,${5 + b}`} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Where each bar sits: "section.bar", counting bars only (matches lib/flags/ref). */
type BarIds = { ids: Map<BarCell, string>; hold?: HoldMarks; play?: PlayMarks } | null;

/** Upload player: highlight the bar being played ("section.bar") and jump on tap. */
export interface PlayMarks {
  current: string | null;
  onTap: (id: string) => void;
}

function barIds(view: ChartView, hold: HoldMarks | undefined, play?: PlayMarks): BarIds {
  if (!hold && !play) return null;
  const ids = new Map<BarCell, string>();
  view.sections.forEach((s, i) => {
    let n = 0;
    for (const row of s.rows) for (const c of row) if (c.kind === "bar") ids.set(c, `${i}.${n++}`);
  });
  return { ids, hold, play };
}

function Line({ line, chords, bars }: { line: GridLine; chords: boolean; bars?: BarIds }) {
  if (!line.bars.length) {
    return (
      <div className="flex flex-wrap items-center gap-[0.25em]">
        {line.after?.notes.map((n, i) => <NoteChip key={i} n={n} chords={chords} />)}
      </div>
    );
  }
  const marks = line.bars.some((x) => x.cell.beats.some((b) => b.push || b.end));
  return (
    <div className="grid grid-cols-4 gap-x-[0.35em] gap-y-[0.1em]">
      {line.above.map((g, i) => (
        <div
          key={`a${i}`}
          className="flex min-w-0 flex-wrap items-end gap-[0.2em]"
          style={{ gridColumn: `${g.col + 1} / span ${g.span}`, gridRow: 1 }}
        >
          {g.notes.map((n, j) => <NoteChip key={j} n={n} chords={chords} />)}
        </div>
      ))}
      {line.bars.map((x) => {
        const id = bars?.ids.get(x.cell);
        const plain = <Bar cell={x.cell} chords={chords} marks={marks} spot={bars?.hold && id ? { id, hold: bars.hold } : null} />;
        const bar =
          x.open || x.close !== null ? (
            <div className="flex flex-col">
              <div className="flex items-end gap-[0.08em]">
                {x.open && <RepeatMark end={false} />}
                <div className="min-w-0">{plain}</div>
                {x.close !== null && <RepeatMark end />}
              </div>
              {x.close && <span className="truncate text-[0.4em] italic leading-tight text-bb-cue-gray">{x.close}</span>}
            </div>
          ) : (
            plain
          );
        if (bars?.play && id) {
          const on = bars.play.current === id;
          return (
            <button
              key={x.col}
              type="button"
              data-bar
              data-play-bar={id}
              aria-current={on ? "true" : undefined}
              aria-label="Play from this bar"
              onClick={() => bars.play!.onTap(id)}
              className={`min-w-0 self-end overflow-hidden rounded-[0.12em] text-left outline-offset-[0.06em] ${on ? "bg-bb-downbeat-amber/25 outline outline-[0.08em] outline-bb-downbeat-amber" : ""}`}
              style={{ gridColumn: x.col + 1, gridRow: 2 }}
            >
              {bar}
            </button>
          );
        }
        return (
          <div key={x.col} data-bar className="min-w-0 self-end overflow-hidden" style={{ gridColumn: x.col + 1, gridRow: 2 }}>
            {bar}
          </div>
        );
      })}
      {line.after && (
        <div
          className={`flex min-w-0 flex-wrap items-center gap-[0.2em] ${line.afterBelow ? "justify-end" : "self-center"}`}
          style={{ gridColumn: `${line.after.col + 1} / span ${line.after.span}`, gridRow: line.afterBelow ? 4 : 2 }}
        >
          {line.after.notes.map((n, j) => <NoteChip key={j} n={n} chords={chords} />)}
        </div>
      )}
      {line.hairpins.map((h, i) => (
        <Wedge key={`h${i}`} h={h} />
      ))}
    </div>
  );
}

export default function Chart({
  view,
  chords,
  fontFamily,
  fontWeight,
  style,
  rootRef,
  marks,
  hold,
  play,
  columns,
}: {
  view: ChartView;
  chords: boolean;
  fontFamily: string;
  fontWeight?: number;
  style?: CSSProperties;
  rootRef?: Ref<HTMLDivElement>;
  /** Review screen only: outline these rows ("section-row") and report taps on them. */
  marks?: { rows: Set<string>; active: string | null; onTap: (row: string) => void };
  /** Song page and stage mode: tag beats for press-and-hold and draw personal flag markers. */
  hold?: HoldMarks;
  /** Upload player: bar marker + tap a bar to jump the audio there. */
  play?: PlayMarks;
  /** Whole song view: sections flow into columns and are never split. `count` + `height`
   *  (stage mode) fills a fixed box, extra columns overflow to the right as pages; without
   *  them (song page) the browser makes as many ~13em columns as fit. */
  columns?: { count?: number; height?: number; innerRef?: Ref<HTMLDivElement> };
}) {
  const bars = barIds(view, hold, play);
  return (
    <div
      ref={rootRef}
      className="@container w-full font-bold leading-none tabular-nums"
      style={{ fontFamily, fontWeight, ...style }}
    >
      <div
        ref={columns?.innerRef}
        className={columns ? "" : "flex flex-col gap-[0.65em]"}
        style={
          columns
            ? columns.count
              ? { columnCount: columns.count, columnGap: "1.2em", columnFill: "auto", height: columns.height }
              : { columnWidth: "13em", columnGap: "1.5em" }
            : undefined
        }
      >
        {view.sections.map((s, i) => (
          <section
            key={i}
            data-section={i}
            className={columns ? "mb-[0.65em] flex break-inside-avoid flex-col gap-[0.2em]" : "flex flex-col gap-[0.2em] @md:flex-row @md:gap-[0.35em]"}
          >
            <h2 className={columns ? "shrink-0" : "shrink-0 @md:w-[2.2em] @md:pt-[0.3em]"}>
              <span className="inline-flex max-w-full flex-wrap items-baseline gap-[0.15em] break-words rounded-[0.15em] border-[0.06em] border-bb-downbeat-amber px-[0.3em] py-[0.12em] text-[0.55em] leading-none text-bb-downbeat-amber">
                {s.label.replace(/ x\d+$/, "")}
                {s.repeat > 1 && <span className="text-[0.85em]">×{s.repeat}</span>}
              </span>
            </h2>
            <div className="flex min-w-0 flex-1 flex-col gap-[0.3em]">
              {marks
                ? s.rows.map((row, j) => {
                    const id = `${i}-${j}`;
                    const lines = layoutRow(row).map((line, k) => <Line key={k} line={line} chords={chords} />);
                    if (!marks.rows.has(id)) return <div key={j} data-row={id} className="flex flex-col gap-[0.3em]">{lines}</div>;
                    return (
                      <button
                        key={j}
                        type="button"
                        data-row={id}
                        onClick={() => marks.onTap(id)}
                        aria-label="Unclear spot: show it in the editor"
                        className={`flex flex-col gap-[0.3em] rounded-[0.2em] text-left outline outline-[0.08em] outline-offset-[0.12em] ${
                          marks.active === id ? "bg-bb-downbeat-amber/25 outline-bb-downbeat-amber" : "bg-bb-downbeat-amber/15 outline-bb-downbeat-amber"
                        }`}
                      >
                        {lines}
                      </button>
                    );
                  })
                : s.rows.flatMap((row, j) =>
                    layoutRow(row).map((line, k) => <Line key={`${j}-${k}`} line={line} chords={chords} bars={bars} />),
                  )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
