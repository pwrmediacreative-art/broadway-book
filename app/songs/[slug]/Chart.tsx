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

function Caret({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 20 12" className={className} aria-hidden>
      <polyline points="2,11 10,2 18,11" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Fermata({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 14" className={className} aria-hidden>
      <path d="M2 13 A10 10 0 0 1 22 13" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="12" cy="10" r="2.4" fill="currentColor" />
    </svg>
  );
}

function Name({ b, chords }: { b: BeatView; chords: boolean }) {
  const p = chords ? b.c : b.n;
  if (b.kind === "repeat") return <span className="text-foreground/85">%</span>;
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

function Beat({ b, chords, marks }: { b: BeatView; chords: boolean; marks: boolean }) {
  return (
    <span className="inline-flex flex-col items-start px-[0.1em]">
      {marks && (
        <span className="relative h-[0.42em] w-full min-w-[0.5em]" aria-hidden>
          {b.push && <Caret className="absolute bottom-0 left-0 h-[0.36em] w-[0.55em] text-accent" />}
          {b.end === "fermata" && (
            <Fermata className="absolute bottom-0 left-1/2 h-[0.4em] w-[0.75em] -translate-x-1/2 text-accent" />
          )}
          {b.end === "stop" && (
            <span className="absolute bottom-[0.04em] right-0 size-[0.28em] rounded-full bg-red-400" />
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

function Bar({ cell, chords, marks }: { cell: BarCell; chords: boolean; marks: boolean }) {
  const beats = cell.beats.map((b, i) => (
    <span key={i} className={i ? "border-l-[0.05em] border-foreground/45" : ""}>
      <Beat b={b} chords={chords} marks={marks} />
    </span>
  ));
  return (
    <div style={{ fontSize: `${barScale(cell, chords)}em` }}>
      {cell.beats.length === 1 ? (
        beats
      ) : (
        <span className="inline-flex items-end rounded-[0.14em] border-[0.06em] border-foreground/75 px-[0.06em]" title="Split bar">
          {beats}
        </span>
      )}
    </div>
  );
}

function NoteChip({ n }: { n: Note }) {
  if (n.kind === "change")
    return (
      <span className="rounded-[0.3em] border-[0.08em] border-[var(--chg,#7dd3fc)] px-[0.4em] py-[0.12em] text-[0.45em] font-semibold leading-tight text-[var(--chg,#7dd3fc)]">
        {pretty(n.text.replace(/^Key: /, "Key → "))}
      </span>
    );
  if (n.kind === "dynamic") return <span className="text-[0.45em] italic text-muted">{n.text}</span>;
  return <span className="text-[0.45em] font-semibold italic leading-tight text-accent">“{n.text}”</span>;
}

function Wedge({ h }: { h: Hairpin }) {
  const open = (t: number) => (h.dir === "cresc" ? t : 1 - t);
  const a = 5 * open(h.from);
  const b = 5 * open(h.to);
  return (
    <svg
      viewBox="0 0 100 10"
      preserveAspectRatio="none"
      className="h-[0.4em] w-full text-muted"
      style={{ gridColumn: `${h.col + 1} / span ${h.span}`, gridRow: 3 }}
      role="img"
      aria-label={h.dir === "cresc" ? "crescendo" : "decrescendo"}
    >
      <polyline points={`0,${5 - a} 100,${5 - b}`} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <polyline points={`0,${5 + a} 100,${5 + b}`} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Line({ line, chords }: { line: GridLine; chords: boolean }) {
  if (!line.bars.length) {
    return (
      <div className="flex flex-wrap items-center gap-[0.25em]">
        {line.after?.notes.map((n, i) => <NoteChip key={i} n={n} />)}
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
          {g.notes.map((n, j) => <NoteChip key={j} n={n} />)}
        </div>
      ))}
      {line.bars.map((x) => (
        <div key={x.col} data-bar className="min-w-0 self-end overflow-hidden" style={{ gridColumn: x.col + 1, gridRow: 2 }}>
          <Bar cell={x.cell} chords={chords} marks={marks} />
        </div>
      ))}
      {line.after && (
        <div
          className={`flex min-w-0 flex-wrap items-center gap-[0.2em] ${line.afterBelow ? "justify-end" : "self-center"}`}
          style={{ gridColumn: `${line.after.col + 1} / span ${line.after.span}`, gridRow: line.afterBelow ? 4 : 2 }}
        >
          {line.after.notes.map((n, j) => <NoteChip key={j} n={n} />)}
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
}: {
  view: ChartView;
  chords: boolean;
  fontFamily: string;
  fontWeight?: number;
  style?: CSSProperties;
  rootRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={rootRef}
      className="@container w-full font-bold leading-none tabular-nums"
      style={{ fontFamily, fontWeight, ...style }}
    >
      <div className="flex flex-col gap-[0.65em]">
        {view.sections.map((s, i) => (
          <section key={i} className="flex flex-col gap-[0.2em] @md:flex-row @md:gap-[0.35em]">
            <h2 className="shrink-0 @md:w-[2.2em] @md:pt-[0.3em]">
              <span className="inline-flex items-baseline gap-[0.15em] rounded-[0.15em] border-[0.06em] border-accent px-[0.3em] py-[0.12em] text-[0.55em] leading-none text-accent">
                {s.label.replace(/ x\d+$/, "")}
                {s.repeat > 1 && <span className="text-[0.85em]">×{s.repeat}</span>}
              </span>
            </h2>
            <div className="flex min-w-0 flex-1 flex-col gap-[0.3em]">
              {s.rows.flatMap((row, j) =>
                layoutRow(row).map((line, k) => <Line key={`${j}-${k}`} line={line} chords={chords} />),
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
