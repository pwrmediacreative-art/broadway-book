"use client";

// Audio player beside an uploaded chart. The play marker follows the chart's bars using
// one tap sync point (where bar 1 starts) and the chart's BPM; tap a bar to jump there.
// Loop a section; slow down 0.5x–1x with pitch kept (the browser's preservesPitch).
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface PlayerHandle {
  /** Jump to a step in the play order (index into `order`). */
  seekStep: (step: number) => void;
}

export interface PlayerProps {
  src: string;
  bpm: number | null;
  beatsPerBar: number;
  order: string[]; // bar ids in play order (repeats written out)
  sync: { start: number; bars: number } | null;
  loop: { from: number; to: number; label: string } | null; // steps, `to` exclusive
  onLoopClear: () => void;
  onBar: (id: string | null) => void;
  onSync: (start: number) => void;
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

const Player = forwardRef<PlayerHandle, PlayerProps>(function Player({ src, bpm, beatsPerBar, order, sync, loop, onLoopClear, onBar, onSync }, ref) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [rate, setRate] = useState(1);
  const [err, setErr] = useState<string | null>(null);
  const barSec = bpm ? (beatsPerBar * 60) / bpm : null;
  const ready = !!(sync && barSec);
  const drift = ready && sync!.bars !== order.length;

  const stepAt = useCallback((t: number) => (ready ? Math.floor((t - sync!.start) / barSec!) : -1), [ready, sync, barSec]);
  const timeOf = useCallback((step: number) => (ready ? sync!.start + step * barSec! : 0), [ready, sync, barSec]);

  useImperativeHandle(ref, () => ({
    seekStep: (step: number) => {
      const a = audio.current;
      if (!a || !ready) return;
      a.currentTime = Math.max(0, timeOf(step) + 0.01);
      setTime(a.currentTime);
      const s = stepAt(a.currentTime);
      onBar(s >= 0 && s < order.length ? order[s] : null);
    },
  }));

  // marker + loop, smooth while playing
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const a = audio.current;
      if (a) {
        if (loop && ready && a.currentTime >= timeOf(loop.to)) a.currentTime = timeOf(loop.from) + 0.01;
        const s = stepAt(a.currentTime);
        onBar(s >= 0 && s < order.length ? order[s] : null);
        setTime(a.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    if (playing) raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, loop, ready, timeOf, stepAt, order, onBar]);

  useEffect(() => {
    const a = audio.current as (HTMLAudioElement & { preservesPitch?: boolean; webkitPreservesPitch?: boolean }) | null;
    if (!a) return;
    a.playbackRate = rate;
    a.preservesPitch = true;
    a.webkitPreservesPitch = true;
  }, [rate]);

  // starting a loop jumps to it
  useEffect(() => {
    const a = audio.current;
    if (a && loop && ready) a.currentTime = timeOf(loop.from) + 0.01;
  }, [loop, ready, timeOf]);

  const toggle = async () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) {
      try {
        await a.play();
      } catch {
        setErr("The audio couldn't start. Reload the page and try again.");
      }
    } else a.pause();
  };

  const big = "bb-btn h-14 min-w-14 px-4 text-xl font-bold";
  return (
    <div className="bb-panel flex flex-col gap-3 px-3 py-3">
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
        onTimeUpdate={(e) => !playing && setTime(e.currentTarget.currentTime)}
        onError={() => setErr("The audio link ran out. Reload the page to play again.")}
      />
      <div className="flex items-center gap-2">
        <button type="button" className={`${big} bb-btn-primary`} onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
          {playing ? "❚❚" : "▶"}
        </button>
        <button
          type="button"
          className={`${big} bb-btn-secondary text-lg`}
          onClick={() => audio.current && (audio.current.currentTime = Math.max(0, audio.current.currentTime - 5))}
          aria-label="Back 5 seconds"
        >
          −5s
        </button>
        <span className="ml-auto font-bb-data text-lg tabular-nums text-bb-cue-gray">
          {fmt(time)} / {fmt(dur || 0)}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={dur || 0}
        step={0.1}
        value={time}
        onChange={(e) => audio.current && (audio.current.currentTime = Number(e.target.value))}
        aria-label="Position"
        className="h-11 w-full accent-bb-downbeat-amber"
      />
      <div className="flex items-center gap-2">
        <label className="flex flex-1 items-center gap-2 text-lg">
          <span className="shrink-0">Speed</span>
          <input
            type="range"
            min={0.5}
            max={1}
            step={0.05}
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            aria-label="Playback speed"
            className="h-11 min-w-0 flex-1 accent-bb-downbeat-amber"
          />
          <span className="w-14 shrink-0 text-right font-bb-data tabular-nums">{rate.toFixed(2)}×</span>
        </label>
        <button type="button" className={`bb-btn h-12 px-4 text-lg font-bold ${rate === 1 ? "bb-on" : "bb-btn-secondary"}`} onClick={() => setRate(1)}>
          1×
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="bb-btn bb-btn-secondary h-12 px-4 text-lg font-semibold"
          onClick={() => audio.current && onSync(Math.round(audio.current.currentTime * 100) / 100)}
        >
          Sync: bar 1 is now
        </button>
        {loop && (
          <button type="button" className="bb-btn bb-on h-12 px-4 text-lg font-semibold" onClick={onLoopClear}>
            Looping {loop.label} ✕
          </button>
        )}
      </div>
      <p className="text-base text-bb-cue-gray">
        {!bpm
          ? "Add {bpm: …} to the chart to turn on the bar marker."
          : !sync
            ? "Play, then tap Sync right on the first downbeat of bar 1 to line up the bar marker."
            : drift
              ? "Bar count changed: the play marker may be off. Tap Sync again on bar 1 to reset it."
              : "Tap a bar to jump there. The marker follows the chart's BPM, so it drifts if the band speeds up."}
      </p>
      {err && (
        <p role="alert" className="bb-error px-3 py-2 text-lg">
          {err}
        </p>
      )}
    </div>
  );
});

export default Player;
