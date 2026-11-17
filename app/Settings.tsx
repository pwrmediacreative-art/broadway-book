"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { setDisplay, type Display } from "@/lib/display";
import { PREF, setPref, usePref } from "@/lib/prefs";
import { useLyricsAllowed } from "./songs/[slug]/Lyrics";

/** The two big "How do you read charts?" buttons (first visit and Settings). */
export function DisplayPicker({ onPick, autoFocus = false }: { onPick?: (v: Display) => void; autoFocus?: boolean }) {
  const cur = usePref(PREF.display);
  const pick = (v: Display) => {
    setDisplay(v);
    onPick?.(v);
  };
  const opt = (v: Display, title: string, sample: string) => (
    <button
      type="button"
      autoFocus={autoFocus && v === "numbers"}
      onClick={() => pick(v)}
      aria-pressed={cur === v}
      className={`bb-btn flex min-h-20 flex-1 flex-col items-center justify-center gap-1 px-3 py-3 ${cur === v ? "bb-btn-primary" : "bb-btn-secondary"}`}
    >
      <span className="text-xl font-bold">{title}</span>
      <span className="text-base font-normal">{sample}</span>
    </button>
  );
  return (
    <div className="flex gap-3">
      {opt("numbers", "Numbers", "Nashville")}
      {opt("chords", "Chords", "C, G, Am…")}
    </div>
  );
}

/** Gear in the top bar: app settings (works signed in or out, and offline). */
export default function SettingsButton() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Settings"
        title="Settings"
        className="inline-flex size-11 items-center justify-center text-bb-cue-gray active:text-bb-chart-white"
      >
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.08a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.08a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-end bg-bb-stage-black/80 sm:items-center sm:justify-center" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-label="Settings"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85dvh] w-full overflow-y-auto border-t border-bb-rule-gray bg-bb-house-black p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-md sm:border"
          >
            <div className="mb-4 flex items-center gap-2">
              <h2 className="flex-1 text-xl font-bold">Settings</h2>
              <button onClick={() => setOpen(false)} aria-label="Close" className="bb-btn bb-btn-quiet size-11 p-0 text-2xl text-bb-cue-gray">
                ✕
              </button>
            </div>
            <h3 className="mb-2 text-lg font-semibold">How do you read charts?</h3>
            <DisplayPicker />
            <p className="mt-2 text-base text-bb-cue-gray">The default on every chart, stage mode and setlists. The 123 / ABC switch on a song still flips it.</p>
            <LayoutSetting />
            <LyricsToggle />
            <Link href="/notes" onClick={() => setOpen(false)} className="bb-btn bb-btn-secondary mt-5 flex h-12 w-full items-center justify-center text-lg">
              My notes (flags and my versions)
            </Link>
          </div>
        </div>
      )}
    </>
  );
}

/** Lyrics on/off for this device. Shown only when the /admin audience includes this player. */
function LyricsToggle() {
  const allowed = useLyricsAllowed();
  const on = usePref(PREF.lyrics) === "1";
  if (!allowed) return null;
  const opt = (v: boolean, label: string) => (
    <button
      type="button"
      aria-pressed={on === v}
      onClick={() => setPref(PREF.lyrics, v ? "1" : null)}
      className={`bb-btn h-12 flex-1 px-4 text-lg ${on === v ? "bb-btn-primary" : "bb-btn-secondary"}`}
    >
      {label}
    </button>
  );
  return (
    <>
      <h3 className="mb-2 mt-6 text-lg font-semibold">Lyrics</h3>
      <div className="flex gap-3">
        {opt(false, "Off")}
        {opt(true, "On")}
      </div>
      <p className="mt-2 text-base text-bb-cue-gray">Beside the chart on a big screen, a pull-up drawer on a phone. From LRCLIB, not stored by Broadway Book.</p>
    </>
  );
}

/** Scroll / Whole song, and the smallest text size Whole song uses before it turns pages. */
function LayoutSetting() {
  const whole = usePref(PREF.layout) === "whole";
  const min = Number(usePref(PREF.wholeMin)) || 24;
  const opt = (on: boolean, label: string, onClick: () => void) => (
    <button type="button" aria-pressed={on} onClick={onClick} className={`bb-btn h-12 flex-1 px-3 text-lg ${on ? "bb-btn-primary" : "bb-btn-secondary"}`}>
      {label}
    </button>
  );
  return (
    <>
      <h3 className="mb-2 mt-6 text-lg font-semibold">Chart layout</h3>
      <div className="flex gap-3">
        {opt(!whole, "Scroll", () => setPref(PREF.layout, null))}
        {opt(whole, "Whole song", () => setPref(PREF.layout, "whole"))}
      </div>
      <p className="mt-2 text-base text-bb-cue-gray">Whole song puts the chart on one screen in columns. If it can’t fit, it turns pages (pedal, arrows, swipe or tap an edge).</p>
      {whole && (
        <>
          <p className="mb-2 mt-3 text-base">Smallest text before pages</p>
          <div className="flex gap-2">
            {[20, 24, 28, 32].map((n) => (
              <span key={n} className="contents">
                {opt(min === n, `${n}`, () => setPref(PREF.wholeMin, n === 24 ? null : String(n)))}
              </span>
            ))}
          </div>
        </>
      )}
    </>
  );
}
