"use client";

import { useEffect, useRef } from "react";
import { beatsPerBar, keyChoices, pretty } from "@/lib/chart";
import type { ChartState } from "./hooks";

export const btn = "h-12 min-w-12 rounded-lg px-4 text-lg font-semibold";
export const on = "bg-accent text-black";
export const off = "bg-panel text-foreground border border-line";

/** Key picker, Numbers/Chords toggle and (minor keys) 1- / 6- numbering. */
export function DisplayControls({ s }: { s: ChartState }) {
  const view = s.view!;
  const { meta } = view;
  return (
    <>
      {view.displayKey && (
        <select
          value={view.displayKey}
          onChange={(e) => s.setKey(e.target.value)}
          className={`${btn} ${off} font-mono`}
          aria-label="Key"
        >
          {!keyChoices(view.minor).includes(view.displayKey) && <option>{view.displayKey}</option>}
          {keyChoices(view.minor).map((k) => (
            <option key={k} value={k}>
              {pretty(k)}
              {k === meta.key ? " (orig)" : ""}
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
        <div className="flex" role="group" aria-label="Minor key numbering">
          <button
            className={`${btn} rounded-r-none ${view.style === "minor" ? on : off}`}
            onClick={() => s.setStyle("minor")}
            aria-pressed={view.style === "minor"}
          >
            1-
          </button>
          <button
            className={`${btn} rounded-l-none ${view.style === "relative" ? on : off}`}
            onClick={() => s.setStyle("relative")}
            aria-pressed={view.style === "relative"}
          >
            6-
          </button>
        </div>
      )}
    </>
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
      el.style.opacity = lit ? "1" : "0.2";
      el.style.transform = lit && down ? "scale(1.35)" : "scale(1)";
      el.style.background = lit && down ? "#fde68a" : "var(--accent)";
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [bpm, time, active]);
  return (
    <span
      ref={dot}
      aria-hidden
      className={`inline-block size-3 rounded-full ${active ? "bg-accent" : "border-2 border-muted"}`}
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
        <b className="text-foreground">{bpm}</b> bpm
      </span>
    </button>
  );
}
