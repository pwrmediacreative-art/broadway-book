"use client";

import { useEffect } from "react";
import { pretty } from "@/lib/chart";
import { dupQuestion, shownKey, type SetItem } from "@/lib/setlists/play";

export const btn = "bb-btn h-12 min-w-12 px-4 text-lg";
export const primary = "bb-btn-primary";
export const plain = "bb-btn-secondary";

/** In-app "already in this setlist" question. Cancel is the default: focused first, primary, and Escape. */
export function DupConfirm({ title, n, onAdd, onCancel }: { title: string; n: number; onAdd: () => void; onCancel: () => void }) {
  useEffect(() => {
    // Capture phase, so Escape only cancels this question instead of also closing the sheet around it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="bb-dup-q">
      <p id="bb-dup-q" className="mb-4 text-xl text-bb-chart-white">
        {dupQuestion(title, n)}
      </p>
      <div className="flex gap-2">
        <button autoFocus onClick={onCancel} className={`${btn} ${primary} h-14 flex-1`}>
          Cancel
        </button>
        <button onClick={onAdd} className={`${btn} ${plain} h-14 flex-1`}>
          Add again
        </button>
      </div>
    </div>
  );
}

/** "Fri, Nov 20" from a YYYY-MM-DD date, without timezone shifts. */
export function gigDate(d: string | null): string | null {
  if (!d) return null;
  const [y, m, day] = d.split("-").map(Number);
  const date = new Date(y, m - 1, day);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

/** Read-only song list (shared links, snapshots, play-mode jump list). */
export function SetSongList({ items, current, onPick }: { items: SetItem[]; current?: number; onPick?: (itemIndex: number) => void }) {
  let n = 0;
  return (
    <ol className="divide-y divide-bb-rule-gray border-y border-bb-rule-gray">
      {items.map((it, i) => {
        const ok = !!it.song;
        if (ok) n++;
        const k = shownKey(it);
        const body = (
          <>
            <span className="w-8 shrink-0 text-right font-bb-data text-lg tabular-nums text-bb-cue-gray">{ok ? n : "–"}</span>
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-xl font-semibold ${ok ? "" : "text-bb-cue-gray line-through"}`}>{it.song?.title ?? (it.hidden ? "Private chart" : "Not available")}</span>
              {it.note && <span className="block truncate text-base text-bb-cue-gray">{it.note}</span>}
            </span>
            {ok && k && <span className="shrink-0 font-bb-data text-2xl font-bold text-bb-chart-white">{pretty(k)}</span>}
          </>
        );
        const cls = `flex min-h-16 w-full items-center gap-3 px-3 py-2 text-left ${i === current ? "bg-bb-downbeat-amber/15" : "bg-bb-case-charcoal"}`;
        return (
          <li key={i}>
            {onPick && ok ? (
              <button className={`${cls} active:bg-bb-rule-gray`} onClick={() => onPick(i)} aria-current={i === current ? "true" : undefined}>
                {body}
              </button>
            ) : (
              <div className={cls}>{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function enterFullscreen() {
  try {
    document.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {});
  } catch {
    // not supported (iPhone Safari)
  }
}
