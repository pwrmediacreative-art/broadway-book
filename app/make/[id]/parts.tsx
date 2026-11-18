"use client";

// Pieces of the tap-to-build editor: item chips, the bottom sheet, the number pad.
import { useRef, type ReactNode } from "react";
import { beatText, pretty, type RowItem } from "@/lib/chart";
import { isBar, qualityFlags } from "@/lib/make/model";

/** What a chip says: "5-7", "(4 1)", "|:", ":| repeat out", "[Band in]", "Mod +5". */
export function chipText(it: RowItem): string {
  switch (it.kind) {
    case "split":
      return it.beats.map((b) => pretty(beatText(b))).join(" ");
    case "box":
      return it.text;
    case "cue":
      return `“${it.text}”`;
    case "repeatSign":
      return it.side === "start" ? "|:" : it.text ? `:| ${it.text}` : ":|";
    case "tag":
      return it.name === "mod" ? `Key ${Number(it.value) > 0 ? "↑" : "↓"}${Math.abs(Number(it.value))}` : `${it.name}: ${it.value}`;
    case "dynamic":
      return it.value === "cresc" ? "<<" : ">>";
    default:
      return pretty(beatText(it));
  }
}

/**
 * One item in a section. Bars are big tap targets; tap selects (to edit), press and hold
 * (500ms, under 10px of movement) opens the copy / paste / delete menu.
 */
export function Chip({
  it,
  selected,
  changed,
  onTap,
  onHold,
}: {
  it: RowItem;
  selected: boolean;
  changed: boolean;
  onTap: () => void;
  onHold?: () => void;
}) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const held = useRef(false);
  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const bar = isBar(it);
  const ring = selected ? "outline outline-2 outline-offset-1 outline-bb-downbeat-amber" : "";
  const look = bar
    ? `min-w-16 justify-center px-2 font-bb-chart text-2xl font-bold ${changed ? "bg-bb-downbeat-amber/15" : "bg-bb-case-charcoal"}`
    : it.kind === "box"
      ? "border border-bb-chart-white bg-bb-house-black px-2 text-base font-semibold"
      : "bg-bb-house-black px-2 text-base font-semibold text-bb-cue-gray";
  return (
    <button
      type="button"
      data-chip
      aria-pressed={selected}
      aria-label={bar ? `Bar ${chipText(it)}${changed ? ", differs from the original" : ""}` : chipText(it)}
      className={`flex h-14 shrink-0 select-none items-center ${look} ${ring}`}
      onPointerDown={(e) => {
        if (!onHold) return;
        held.current = false;
        start.current = { x: e.clientX, y: e.clientY };
        cancel();
        timer.current = window.setTimeout(() => {
          held.current = true;
          onHold();
        }, 500);
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) cancel();
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => {
        if (onHold) e.preventDefault();
      }}
      onClick={() => {
        if (held.current) {
          held.current = false;
          return;
        }
        onTap();
      }}
    >
      {it.kind === "split" ? (
        <span className="flex gap-2 border-b-2 border-bb-chart-white leading-tight">
          {it.beats.map((b, i) => (
            <span key={i}>{pretty(beatText(b))}</span>
          ))}
        </span>
      ) : (
        <span className="whitespace-nowrap">{chipText(it)}</span>
      )}
    </button>
  );
}

/** Bottom sheet (dialog). */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-bb-stage-black/80 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88dvh] w-full max-w-lg flex-col rounded-bb-none border-t border-bb-rule-gray bg-bb-case-charcoal sm:border"
      >
        <div className="flex items-center justify-between border-b border-bb-rule-gray px-4 py-2">
          <h2 className="text-xl font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="h-12 px-3 text-lg text-bb-cue-gray active:text-bb-chart-white">
            Close
          </button>
        </div>
        <div className="overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">{children}</div>
      </div>
    </div>
  );
}

export const sheetBtn = "bb-btn bb-btn-secondary h-12 px-4 text-lg font-semibold";

export type PadKey =
  | { k: "digit"; d: number }
  | { k: "acc"; a: "b" | "#" }
  | { k: "q"; q: "minor" | "7" | "maj7" | "sus" }
  | { k: "slash" }
  | { k: "split" }
  | { k: "mod"; m: "diamond" | "push" | "stop" }
  | { k: "more" }
  | { k: "rstart" }
  | { k: "rend" }
  | { k: "note" }
  | { k: "del" }
  | { k: "next" };

export interface PadState {
  acc: "" | "b" | "#";
  slash: boolean;
  split: boolean;
  quality: string | null; // the current chord's quality, null when no chord is selected
  mods: { diamond: boolean; push: boolean; stop: boolean } | null;
  canSplit: boolean;
}

/** The number pad: 1–7, flat/sharp, minor, 7, maj7, sus, slash bass, split bar, holds, pushes, stops, repeats. */
export function Pad({ s, onKey, where, onDone }: { s: PadState; onKey: (k: PadKey) => void; where: string; onDone: () => void }) {
  const key = "bb-btn h-12 min-w-0 px-1 text-xl font-bold";
  const on = (b: boolean) => (b ? "bb-on" : "bb-btn-secondary");
  const f = qualityFlags(s.quality ?? "");
  const has = { minor: f.minor, seven: f["7"], maj7: f.maj7, sus: f.sus };
  return (
    <div
      className="fixed inset-x-0 bottom-[var(--bb-tabs-bottom,0px)] z-40 border-t border-bb-rule-gray bg-bb-house-black px-2 pb-2 pt-1 lg:left-[var(--bb-rail,0px)]"
      role="group"
      aria-label="Number pad"
    >
      <div className="mx-auto max-w-xl">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-base text-bb-cue-gray" aria-live="polite">
            {where}
          </p>
          <button type="button" onClick={onDone} className="h-11 shrink-0 px-3 text-lg font-semibold text-bb-chart-white">
            Done
          </button>
        </div>
        <div className="grid grid-cols-5 gap-1">
          {[1, 2, 3, 4].map((d) => (
            <button key={d} type="button" className={`${key} bb-btn-secondary text-2xl`} onClick={() => onKey({ k: "digit", d })}>
              {s.acc === "b" ? "♭" : s.acc === "#" ? "♯" : ""}
              {d}
            </button>
          ))}
          <button type="button" className={`${key} bb-btn-secondary`} onClick={() => onKey({ k: "del" })} aria-label="Delete">
            ⌫
          </button>
          {[5, 6, 7].map((d) => (
            <button key={d} type="button" className={`${key} bb-btn-secondary text-2xl`} onClick={() => onKey({ k: "digit", d })}>
              {s.acc === "b" ? "♭" : s.acc === "#" ? "♯" : ""}
              {d}
            </button>
          ))}
          <button type="button" className={`${key} ${on(s.acc === "b")}`} aria-pressed={s.acc === "b"} aria-label="Flat" onClick={() => onKey({ k: "acc", a: "b" })}>
            ♭
          </button>
          <button type="button" className={`${key} ${on(s.acc === "#")}`} aria-pressed={s.acc === "#"} aria-label="Sharp" onClick={() => onKey({ k: "acc", a: "#" })}>
            ♯
          </button>

          <button type="button" disabled={s.quality === null} className={`${key} ${on(has.minor)}`} aria-pressed={has.minor} aria-label="Minor" onClick={() => onKey({ k: "q", q: "minor" })}>
            −
          </button>
          <button type="button" disabled={s.quality === null} className={`${key} ${on(has.seven)}`} aria-pressed={has.seven} onClick={() => onKey({ k: "q", q: "7" })}>
            7
          </button>
          <button type="button" disabled={s.quality === null} className={`${key} ${on(has.maj7)} text-lg`} aria-pressed={has.maj7} onClick={() => onKey({ k: "q", q: "maj7" })}>
            maj7
          </button>
          <button type="button" disabled={s.quality === null} className={`${key} ${on(has.sus)} text-lg`} aria-pressed={has.sus} onClick={() => onKey({ k: "q", q: "sus" })}>
            sus
          </button>
          <button type="button" disabled={s.quality === null} className={`${key} ${on(s.slash)}`} aria-pressed={s.slash} aria-label="Slash bass: the next number is the bass note" onClick={() => onKey({ k: "slash" })}>
            /
          </button>

          <button type="button" disabled={!s.canSplit} className={`${key} ${on(s.split)} text-base`} aria-pressed={s.split} onClick={() => onKey({ k: "split" })}>
            Split
          </button>
          <button type="button" disabled={!s.mods} className={`${key} ${on(!!s.mods?.diamond)} text-base`} aria-pressed={!!s.mods?.diamond} aria-label="Hold (diamond)" onClick={() => onKey({ k: "mod", m: "diamond" })}>
            ◇ Hold
          </button>
          <button type="button" disabled={!s.mods} className={`${key} ${on(!!s.mods?.push)} text-base`} aria-pressed={!!s.mods?.push} aria-label="Push" onClick={() => onKey({ k: "mod", m: "push" })}>
            ^ Push
          </button>
          <button type="button" disabled={!s.mods} className={`${key} ${on(!!s.mods?.stop)} text-base`} aria-pressed={!!s.mods?.stop} aria-label="Stop" onClick={() => onKey({ k: "mod", m: "stop" })}>
            Stop
          </button>
          <button type="button" className={`${key} bb-btn-secondary text-base`} onClick={() => onKey({ k: "more" })}>
            More
          </button>

          <button type="button" className={`${key} bb-btn-secondary`} aria-label="Start repeat" onClick={() => onKey({ k: "rstart" })}>
            |:
          </button>
          <button type="button" className={`${key} bb-btn-secondary`} aria-label="End repeat" onClick={() => onKey({ k: "rend" })}>
            :|
          </button>
          <button type="button" className={`${key} bb-btn-secondary col-span-2 text-base`} onClick={() => onKey({ k: "note" })}>
            Note / key change
          </button>
          <button type="button" className={`${key} bb-btn-secondary text-base`} aria-label="Next bar" onClick={() => onKey({ k: "next" })}>
            Next ›
          </button>
        </div>
      </div>
    </div>
  );
}
