"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  beatsPerBar,
  keyLongName,
  keyName,
  keyPickerOptions,
  parseKey,
  pretty,
  relativeKey,
  type ChartView,
  type MinorSymbol,
} from "@/lib/chart";
import { Caret, Fermata } from "./Chart";
import type { ChartState } from "./hooks";

export const btn = "h-12 min-w-12 rounded-lg px-4 text-lg font-semibold";
export const on = "bg-bb-downbeat-amber text-bb-stage-black";
export const off = "bg-bb-case-charcoal text-bb-chart-white border border-bb-rule-gray";

/** Key picker, Numbers/Chords, minor symbol (6- / 6m) and, for minor keys, Relative / Parallel. */
export function DisplayControls({ s }: { s: ChartState }) {
  const view = s.view!;
  const { meta } = view;
  const original = meta.key ? parseKey(meta.key) : null;
  const shown = view.displayKey ? parseKey(view.displayKey) : null;
  const options = original ? keyPickerOptions(original, view.style) : [];
  const selected = options.find((o) => o.pc === shown?.pc)?.value ?? view.displayKey ?? "";
  const m = s.minorSymbol;
  return (
    <>
      {original && (
        <select
          value={selected}
          onChange={(e) => s.setKey(e.target.value)}
          className={`${btn} ${off} font-mono`}
          aria-label="Key"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {pretty(o.label)}
              {o.value === meta.key ? " orig" : ""}
            </option>
          ))}
        </select>
      )}
      <div className="flex" role="group" aria-label="Show as">
        <button className={`${btn} rounded-r-none ${s.chords ? off : on}`} onClick={() => s.setChords(false)} aria-pressed={!s.chords}>
          123
        </button>
        <button className={`${btn} rounded-l-none ${s.chords ? on : off}`} onClick={() => s.setChords(true)} aria-pressed={s.chords}>
          ABC
        </button>
      </div>
      {view.minor && (
        <div className="flex" role="group" aria-label="Minor numbering">
          {(
            [
              ["relative", "Relative", `home ${6}${m}`, "Relative: home is the major key"],
              ["minor", "Parallel", `home 1${m}`, "Parallel: home is the minor key"],
            ] as const
          ).map(([st, label, sub, aria], i) => (
            <button
              key={st}
              className={`flex h-12 flex-col items-center justify-center rounded-lg px-3 leading-tight ${i ? "rounded-l-none" : "rounded-r-none"} ${view.style === st ? on : off}`}
              onClick={() => s.setStyle(st)}
              aria-pressed={view.style === st}
              aria-label={aria}
            >
              <span className="text-base font-semibold">{label}</span>
              <span className="text-xs">{sub}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center" role="group" aria-label="Minor style">
        <span className="mr-2 text-sm text-bb-cue-gray">Minor</span>
        {(["-", "m"] as const).map((sym, i) => (
          <button
            key={sym}
            className={`${btn} px-3 font-mono ${i ? "rounded-l-none" : "rounded-r-none"} ${m === sym ? on : off}`}
            onClick={() => s.setMinorSymbol(sym)}
            aria-pressed={m === sym}
            aria-label={`Show minor as 6${sym === "-" ? " dash" : "m"}`}
          >
            6{sym}
          </button>
        ))}
      </div>
    </>
  );
}

/** "Key A minor (relative to C major)" + Minor/Major chip with a tap-to-open explainer + symbols legend. */
export function KeyInfo({ s, children }: { s: ChartState; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const view = s.view!;
  const label = view.keyLabel;
  const cut = label ? label.indexOf(" (") : -1;
  return (
    <div className="mb-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-lg text-bb-cue-gray">
        {label && (
          <span>
            Key <b className="text-bb-chart-white">{pretty(cut > 0 ? label.slice(0, cut) : label)}</b>
            {cut > 0 && <span> {pretty(label.slice(cut + 1))}</span>}
          </span>
        )}
        {label && (
          <button
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="inline-flex h-11 items-center gap-1 rounded-full border border-bb-downbeat-amber px-3 text-base font-semibold text-bb-downbeat-amber"
          >
            {view.minor ? "Minor" : "Major"} <span aria-hidden>ⓘ</span>
            <span className="sr-only">: what does this mean?</span>
          </button>
        )}
        {children}
      </div>
      {open && view.displayKey && <KeyExplainer view={view} sym={s.minorSymbol} onClose={() => setOpen(false)} />}
      <Legend s={s} />
    </div>
  );
}

function KeyExplainer({ view, sym, onClose }: { view: ChartView; sym: MinorSymbol; onClose: () => void }) {
  const k = parseKey(view.displayKey!)!;
  const other = relativeKey(k);
  const song = pretty(keyLongName(k));
  const rel = pretty(keyLongName(other));
  return (
    <div className="my-2 rounded-xl border border-bb-rule-gray bg-bb-case-charcoal p-4 text-lg leading-snug text-bb-chart-white">
      {view.minor ? (
        <p>
          This song is in <b>{song}</b>, a minor key. Every minor key uses the same notes as a major key three half
          steps up, called its <b className="text-bb-downbeat-amber">relative major</b>: {song} and {rel} share every note.
          So the chart can count from {pretty(keyName(other))} (Relative, home chord = 6{sym}) or from{" "}
          {pretty(keyName(k).slice(0, -1))} (Parallel, home chord = 1{sym}). The chords you play are the same either way.
        </p>
      ) : (
        <p>
          This song is in <b>{song}</b>, a major key: the home chord is 1. Its <b className="text-bb-downbeat-amber">relative minor</b>{" "}
          is {rel}, which uses the same notes, so a 6{sym} chord here is the {pretty(keyName(other))} chord.
        </p>
      )}
      <button onClick={onClose} className={`${btn} ${off} mt-3`}>
        Got it
      </button>
    </div>
  );
}

/** One-line symbols legend, collapsed by default; open/closed is remembered on the device. */
export function Legend({ s }: { s: ChartState }) {
  const items: [ReactNode, string][] = [
    [`6${s.minorSymbol}`, "minor"],
    ["♭7", "flat"],
    ["1/3", "bass note"],
    ["%", "repeat bar"],
    [<Caret key="p" className="inline h-[0.6em] w-[0.9em] text-bb-downbeat-amber" />, "push"],
    ["◇", "let ring"],
    [<Fermata key="f" className="inline h-[0.7em] w-[1.1em] text-bb-downbeat-amber" />, "hold"],
    [<span key="s" className="inline-block size-[0.5em] rounded-full bg-red-400" />, "stop"],
  ];
  return (
    <div>
      <button
        onClick={() => s.setLegend(!s.legend)}
        aria-expanded={s.legend}
        className="inline-flex h-11 items-center gap-1 text-base text-bb-cue-gray active:text-bb-chart-white"
      >
        Symbols {s.legend ? "▾" : "▸"}
      </button>
      {s.legend && (
        <p className="flex flex-wrap gap-x-3 gap-y-1 pb-2 text-lg text-bb-cue-gray">
          {items.map(([sym, what]) => (
            <span key={what}>
              <b className="font-mono text-bb-chart-white">{sym}</b> {what}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/** Silent visual metronome dot. Beat 1 of each bar flashes brighter. */
export function BeatPulse({ bpm, time, active }: { bpm: number; time: string | null; active: boolean }) {
  const dot = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = dot.current;
    if (!el || !active) return;
    const beat = 60000 / bpm;
    const perBar = beatsPerBar(time);
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const n = (now - t0) / beat;
      const phase = n - Math.floor(n);
      const down = Math.floor(n) % perBar === 0;
      const lit = phase < 0.18;
      // Every beat is Downbeat Amber; the downbeat is bigger and full strength, the others a bit dimmer.
      el.style.opacity = lit ? (down ? "1" : "0.7") : "0.2";
      el.style.transform = lit && down ? "scale(1.35)" : "scale(1)";
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [bpm, time, active]);
  return (
    <span
      ref={dot}
      aria-hidden
      className={`inline-block size-3 rounded-full ${active ? "bg-bb-downbeat-amber" : "border-2 border-bb-cue-gray"}`}
      style={active ? undefined : { opacity: 1 }}
    />
  );
}

/** BPM chip that turns the silent beat pulse on/off. */
export function BpmToggle({ s, className = "" }: { s: ChartState; className?: string }) {
  const { bpm, time } = s.view!.meta;
  if (!bpm) return null;
  return (
    <button
      onClick={() => s.setPulse(!s.pulse)}
      aria-pressed={s.pulse}
      aria-label={`${bpm} BPM, beat pulse ${s.pulse ? "on" : "off"}`}
      className={`inline-flex h-11 items-center gap-2 rounded-lg px-2 ${className}`}
    >
      <BeatPulse key={String(s.pulse)} bpm={bpm} time={time} active={s.pulse} />
      <span>
        <b className="text-bb-chart-white">{bpm}</b> bpm
      </span>
    </button>
  );
}
