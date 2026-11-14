"use client";

import { pretty } from "@/lib/chart";
import { shownKey, type SetItem } from "@/lib/setlists/play";

export const btn = "inline-flex h-12 min-w-12 items-center justify-center rounded-lg px-4 text-lg font-semibold";
export const primary = "bg-bb-downbeat-amber text-bb-stage-black active:opacity-80";
export const plain = "border border-bb-rule-gray bg-bb-case-charcoal text-bb-chart-white active:bg-bb-rule-gray";

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
    <ol className="divide-y divide-bb-rule-gray overflow-hidden rounded-xl border border-bb-rule-gray">
      {items.map((it, i) => {
        const ok = !!it.song;
        if (ok) n++;
        const k = shownKey(it);
        const body = (
          <>
            <span className="w-8 shrink-0 text-right text-lg tabular-nums text-bb-cue-gray">{ok ? n : "–"}</span>
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-xl font-semibold ${ok ? "" : "text-bb-cue-gray line-through"}`}>{it.song?.title ?? "Not available"}</span>
              {it.note && <span className="block truncate text-base text-bb-downbeat-amber">{it.note}</span>}
            </span>
            {ok && k && <span className="shrink-0 font-mono text-2xl font-bold text-bb-downbeat-amber">{pretty(k)}</span>}
          </>
        );
        const cls = `flex min-h-16 w-full items-center gap-3 px-3 py-2 text-left ${i === current ? "bg-bb-downbeat-amber/20" : "bg-bb-case-charcoal"}`;
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
