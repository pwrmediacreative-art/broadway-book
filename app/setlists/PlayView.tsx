"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import StageView from "@/app/songs/[slug]/StageView";
import type { Neighbors } from "@/app/songs/[slug]/hooks";
import { readPref, setPref } from "@/lib/prefs";
import { playLabel, playOrder, step, type PlaySet } from "@/lib/setlists/play";
import { SetSongList } from "./ui";

const NO_NEIGHBORS: Neighbors = { prev: null, next: null };

/**
 * Setlist play mode: one screen, songs swap in place (everything is already loaded).
 * Key changes made here last for this play session only. `id` keys the remembered position.
 */
export default function PlayView({ set, id, exitHref, onExit }: { set: PlaySet; id: string; exitHref?: string; onExit?: () => void }) {
  const router = useRouter();
  const exit = () => (onExit ? onExit() : router.push(exitHref ?? "/setlists"));
  const order = useMemo(() => playOrder(set.items), [set.items]);
  const posKey = `bb.play.${id}`;
  // Reopening (or reloading) the same set mid-gig comes back to the same song.
  const [pos, setPos] = useState(() => {
    const p = Number(readPref(posKey, "session"));
    return Number.isInteger(p) && p > 0 && p < order.length ? p : 0;
  });
  useEffect(() => setPref(posKey, String(pos), "session"), [posKey, pos]);

  const [sessionKeys, setSessionKeys] = useState<Record<number, string | null>>({});
  const [jump, setJump] = useState(false);

  // While the jump list is open, keys belong to it (Escape closes it, arrows don't change songs).
  useEffect(() => {
    if (!jump) return;
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      if (e.key === "Escape") setJump(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [jump]);

  if (!order.length) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-bb-stage-black p-6 text-center">
        <div>
          <p className="mb-4 text-2xl">No playable songs in this set.</p>
          <button className="bb-btn bb-btn-primary h-12 px-5 text-lg" onClick={exit}>
            Back
          </button>
        </div>
      </div>
    );
  }

  const idx = order[Math.min(pos, order.length - 1)];
  const item = set.items[idx];
  const song = item.song!;
  const label = playLabel(set.items, order, Math.min(pos, order.length - 1));
  const key = idx in sessionKeys ? sessionKeys[idx] : item.key;

  return (
    <>
      <StageView
        key={idx}
        slug={song.slug}
        title={song.title}
        chartText={song.chart_text}
        neighbors={NO_NEIGHBORS}
        set={{
          count: label.count,
          next: label.next,
          note: item.note,
          keyCtl: { key, setKey: (k) => setSessionKeys((m) => ({ ...m, [idx]: k })) },
          go: (d) => {
            const n = step(order, pos, d);
            if (n === null) return false;
            setPos(n);
            return true;
          },
          onJump: () => setJump(true),
          onExit: exit,
        }}
      />
      {jump && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-bb-house-black" role="dialog" aria-label="Jump to a song">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-bb-rule-gray px-2">
            <button onClick={() => setJump(false)} aria-label="Close" className="bb-btn bb-btn-quiet size-12 p-0 text-2xl text-bb-cue-gray">
              ✕
            </button>
            <b className="min-w-0 flex-1 truncate text-xl">{set.name}</b>
            <span className="shrink-0 pr-2 text-lg text-bb-cue-gray">{label.count}</span>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <SetSongList
              items={set.items.map((it, i) => (i in sessionKeys ? { ...it, key: sessionKeys[i] } : it))}
              current={idx}
              onPick={(i) => {
                setPos(order.indexOf(i));
                setJump(false);
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
