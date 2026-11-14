"use client";

import Link from "next/link";
import { useState } from "react";
import { OfflineNote } from "@/app/OfflineRoot";
import type { PlaySet } from "@/lib/setlists/play";
import PlayView from "./PlayView";
import { btn, enterFullscreen, gigDate, primary, SetSongList } from "./ui";

/**
 * A setlist from the phone's saved copy (offline): view and play only. Play mode runs on
 * the same screen, so nothing has to load.
 */
export default function SavedSet({ set, id, startPlaying = false }: { set: PlaySet; id: string; startPlaying?: boolean }) {
  const [playing, setPlaying] = useState(startPlaying);
  if (playing) return <PlayView set={set} id={id} onExit={() => setPlaying(false)} />;
  const playable = set.items.filter((i) => i.song).length;
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-2">
      <Link href="/setlists" className="inline-flex h-12 items-center text-lg text-bb-cue-gray active:text-bb-chart-white">
        ← Setlists
      </Link>
      <h1 className="text-bb-display">{set.name}</h1>
      <p className="mb-3 text-lg text-bb-cue-gray">
        {[gigDate(set.gig_date), `${playable} song${playable === 1 ? "" : "s"}`, "saved copy"].filter(Boolean).join(" · ")}
      </p>
      <button
        disabled={!playable}
        onClick={() => {
          enterFullscreen();
          setPlaying(true);
        }}
        className={`${btn} ${primary} mb-4 h-14 w-full text-xl`}
      >
        Play set ▸
      </button>
      <SetSongList items={set.items} />
      <OfflineNote className="mt-4" />
      <p className="mt-2 text-base text-bb-cue-gray">Editing and sharing come back when you&apos;re online.</p>
    </main>
  );
}
