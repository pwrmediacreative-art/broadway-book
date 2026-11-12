"use client";

import { useMemo, useState } from "react";
import { buildView, keyChoices, parseChart, type CellView, type NumberStyle } from "@/lib/chart";

function Cell({ cell, chords }: { cell: CellView; chords: boolean }) {
  switch (cell.kind) {
    case "bar":
      if (cell.beats.length === 1) {
        const b = cell.beats[0];
        return <span className="min-w-[3.5rem] font-mono text-3xl font-bold">{chords ? b.chord : b.num}</span>;
      }
      return (
        <span className="inline-flex gap-2 border-b-2 border-foreground/70 font-mono text-3xl font-bold" title="Split bar">
          {cell.beats.map((b, i) => (
            <span key={i}>{chords ? b.chord : b.num}</span>
          ))}
        </span>
      );
    case "cue":
      return <span className="self-center text-lg italic text-accent">“{cell.text}”</span>;
    case "dynamic":
      return (
        <span className="self-center text-lg italic text-muted">{cell.text === "<<" ? "cresc." : "decresc."}</span>
      );
    case "change":
      return (
        <span className="self-center rounded-full border border-accent px-3 py-1 text-base font-semibold text-accent">
          {cell.text}
        </span>
      );
  }
}

export default function ChartDisplay({ chartText }: { chartText: string }) {
  const parsed = useMemo(() => {
    try {
      return { doc: parseChart(chartText).doc, error: null };
    } catch (e) {
      return { doc: null, error: (e as Error).message };
    }
  }, [chartText]);

  const [key, setKey] = useState<string | null>(null);
  const [chords, setChords] = useState(false);
  const [style, setStyle] = useState<NumberStyle | null>(null);

  const view = useMemo(
    () => (parsed.doc ? buildView(parsed.doc, { key, style: style ?? undefined }) : null),
    [parsed.doc, key, style],
  );

  if (!view) {
    return (
      <div className="rounded-xl border border-red-500 p-4">
        <p className="font-semibold">This chart has a format error.</p>
        <p className="text-muted">{parsed.error}</p>
        <pre className="mt-3 whitespace-pre-wrap font-mono text-lg">{chartText}</pre>
      </div>
    );
  }

  const { meta } = view;
  const btn = "h-12 rounded-lg px-4 text-lg font-semibold";
  const on = "bg-accent text-black";
  const off = "bg-panel text-foreground border border-line";

  return (
    <>
      <div className="sticky top-0 z-10 -mx-4 mb-4 flex flex-wrap items-center gap-2 border-b border-line bg-background/95 px-4 py-2 backdrop-blur">
        {view.displayKey && (
          <label className="flex items-center gap-2">
            <span className="sr-only">Key</span>
            <select
              value={view.displayKey}
              onChange={(e) => setKey(e.target.value)}
              className={`${btn} ${off} font-mono`}
              aria-label="Key"
            >
              {!keyChoices(view.minor).includes(view.displayKey) && <option>{view.displayKey}</option>}
              {keyChoices(view.minor).map((k) => (
                <option key={k} value={k}>
                  {k}
                  {k === meta.key ? " (orig)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex" role="group" aria-label="Show as">
          <button className={`${btn} rounded-r-none ${chords ? off : on}`} onClick={() => setChords(false)} aria-pressed={!chords}>
            123
          </button>
          <button className={`${btn} rounded-l-none ${chords ? on : off}`} onClick={() => setChords(true)} aria-pressed={chords}>
            ABC
          </button>
        </div>
        {view.minor && (
          <div className="flex" role="group" aria-label="Minor key numbering">
            <button
              className={`${btn} rounded-r-none ${view.style === "minor" ? on : off}`}
              onClick={() => setStyle("minor")}
              aria-pressed={view.style === "minor"}
            >
              1-
            </button>
            <button
              className={`${btn} rounded-l-none ${view.style === "relative" ? on : off}`}
              onClick={() => setStyle("relative")}
              aria-pressed={view.style === "relative"}
            >
              6-
            </button>
          </div>
        )}
      </div>

      <p className="mb-4 flex flex-wrap gap-x-4 text-lg text-muted">
        {meta.key && (
          <span>
            Key <b className="text-foreground">{view.displayKey}</b>
          </span>
        )}
        {meta.bpm && <span>{meta.bpm} bpm</span>}
        {meta.time && <span>{meta.time}</span>}
        {meta.feel && <span>{meta.feel}</span>}
      </p>

      <div className="space-y-5">
        {view.sections.map((s, i) => (
          <section key={i} className="flex gap-3">
            <h2 className="w-16 shrink-0 pt-1 text-lg font-bold text-accent">{s.label}</h2>
            <div className="min-w-0 flex-1 space-y-2">
              {s.rows.map((row, j) => (
                <div key={j} className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
                  {row.map((c, k) => (
                    <Cell key={k} cell={c} chords={chords} />
                  ))}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
