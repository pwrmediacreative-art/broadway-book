"use client";

// The chart header on one short screen: title (required), artist, key (optional), time,
// BPM (typed or Tap tempo). Used by New chart and by the editor's "Song info" sheet.
import { useEffect, useRef, useState } from "react";
import { keyChoices, pretty } from "@/lib/chart";
import { cleanBpm, TIMES } from "@/lib/make/model";
import { libraryKey } from "./actions";

export interface HeaderValue {
  title: string;
  artist: string;
  key: string | null;
  time: string;
  bpm: number | null;
}

const field = "bb-input h-12 w-full px-3 text-lg";

export default function HeaderFields({ value, onChange, autoFocus }: { value: HeaderValue; onChange: (v: HeaderValue) => void; autoFocus?: boolean }) {
  const set = (p: Partial<HeaderValue>) => onChange({ ...value, ...p });

  // A library song with the same title + artist: offer its key.
  const [hint, setHint] = useState<{ for: string; key: string | null } | null>(null);
  const ask = `${value.title.trim().toLowerCase()}|${value.artist.trim().toLowerCase()}`;
  useEffect(() => {
    if (!value.title.trim()) return;
    let alive = true;
    const t = window.setTimeout(async () => {
      try {
        const key = await libraryKey(value.title, value.artist);
        if (alive) setHint({ for: ask, key });
      } catch {
        // offline or signed out: no hint
      }
    }, 500);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [ask, value.title, value.artist]);
  const libKey = hint && hint.for === ask ? hint.key : null;

  // Tap tempo: average of the last few taps; a pause over 2 seconds starts again.
  const taps = useRef<number[]>([]);
  const tap = () => {
    const now = performance.now();
    const prev = taps.current;
    const list = prev.length && now - prev[prev.length - 1] > 2000 ? [now] : [...prev, now].slice(-6);
    taps.current = list;
    if (list.length >= 2) {
      const avg = (list[list.length - 1] - list[0]) / (list.length - 1);
      set({ bpm: cleanBpm(60000 / avg) });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <label className="block">
        <span className="mb-1 block text-lg font-semibold">Title</span>
        <input
          className={field}
          value={value.title}
          maxLength={200}
          autoFocus={autoFocus}
          required
          onChange={(e) => set({ title: e.target.value })}
          placeholder="Song title"
          autoComplete="off"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-lg font-semibold">
          Artist <span className="font-normal text-bb-cue-gray">(optional)</span>
        </span>
        <input className={field} value={value.artist} maxLength={200} onChange={(e) => set({ artist: e.target.value })} placeholder="Who made it famous" autoComplete="off" />
      </label>

      <div>
        <label htmlFor="mk-key" className="mb-1 block text-lg font-semibold">
          Key <span className="font-normal text-bb-cue-gray">(optional)</span>
        </label>
        <select id="mk-key" className={`${field} font-bb-data font-semibold`} value={value.key ?? ""} onChange={(e) => set({ key: e.target.value || null })}>
          <option value="">No key yet</option>
          {[...keyChoices(false), ...keyChoices(true)].map((k) => (
            <option key={k} value={k}>
              {pretty(k)}
            </option>
          ))}
        </select>
        {libKey && libKey !== value.key && (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-lg">
            Library chart is in {pretty(libKey)}.
            <button type="button" className="bb-btn bb-btn-secondary h-11 px-3 text-base font-semibold" onClick={() => set({ key: libKey })}>
              Use {pretty(libKey)}
            </button>
          </p>
        )}
      </div>

      <fieldset>
        <legend className="mb-1 text-lg font-semibold">Time</legend>
        <div className="flex flex-wrap gap-2">
          {TIMES.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={value.time === t}
              onClick={() => set({ time: t })}
              className={`bb-btn bb-btn-secondary h-12 min-w-14 px-3 font-bb-data text-lg font-semibold ${value.time === t ? "bb-on" : ""}`}
            >
              {t}
            </button>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="mk-bpm" className="mb-1 block text-lg font-semibold">
          Tempo (BPM) <span className="font-normal text-bb-cue-gray">(optional)</span>
        </label>
        <div className="flex gap-2">
          <input
            id="mk-bpm"
            className={`${field} w-28 font-bb-data`}
            inputMode="numeric"
            value={value.bpm ?? ""}
            onChange={(e) => {
              const n = Number(e.target.value.replace(/\D/g, "").slice(0, 3));
              set({ bpm: n > 0 ? n : null });
            }}
            placeholder="—"
          />
          <button type="button" onClick={tap} className="bb-btn bb-btn-secondary h-12 flex-1 px-4 text-lg font-semibold">
            Tap tempo
          </button>
        </div>
      </div>
    </div>
  );
}
