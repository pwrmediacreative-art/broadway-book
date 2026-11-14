"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import SongView, { enterFullscreen } from "@/app/songs/[slug]/SongView";
import StageView from "@/app/songs/[slug]/StageView";
import type { Neighbors } from "@/app/songs/[slug]/hooks";
import { savedNeighbors, savedSong } from "@/lib/offline/charts";
import { LocalNavProvider } from "@/lib/offline/nav";
import type { SavedSong } from "@/lib/offline/plan";
import { savedSongHref } from "@/lib/offline/routes";
import { checkOffline } from "@/lib/offline/status";

type Load = { slug: string; song: SavedSong | null; neighbors: Neighbors };

/**
 * /offline/song?s=<slug>[&stage=1]. The chart comes from the phone's copy as it was when the
 * song was opened (a sync never swaps a chart on screen). Song links change the address in
 * place, so moving between songs and into stage mode needs no page load.
 */
export default function SavedSongPage() {
  const params = useSearchParams();
  const slug = params.get("s") ?? "";
  const stage = params.get("stage") === "1";
  const [load, setLoad] = useState<Load | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [song, neighbors] = await Promise.all([savedSong(slug), savedNeighbors(slug)]);
      if (!alive) return;
      // Not on this phone: if we're actually online, the real page has it.
      if (!song && slug && !(await checkOffline())) return location.replace(`/songs/${encodeURIComponent(slug)}${stage ? "/stage" : ""}`);
      if (alive) setLoad({ slug, song, neighbors });
    })();
    return () => {
      alive = false;
    };
    // `stage` only matters for the redirect above; switching views must not reload the chart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // Song links (/songs/x, /songs/x/stage) become address changes on this page.
  const local = useCallback((href: string) => {
    const to = savedSongHref(new URL(href, location.origin).pathname);
    if (!to) return false;
    window.history.pushState(null, "", to);
    return true;
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target || a.origin !== location.origin) return;
      if (!local(a.pathname)) return;
      e.preventDefault();
      e.stopPropagation();
      if (a.pathname.endsWith("/stage")) enterFullscreen();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [local]);

  if (!load || load.slug !== slug) return null;
  const { song, neighbors } = load;
  if (!song) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-8 text-center">
        <p className="mb-6 text-2xl">This chart isn&apos;t saved on this phone yet.</p>
        <Link href="/" className="bb-btn bb-btn-primary h-14 px-6 text-xl">
          Back to search
        </Link>
      </main>
    );
  }
  return (
    <LocalNavProvider value={local}>
      {stage ? (
        <StageView key={slug} slug={song.slug} title={song.title} chartText={song.chart_text} neighbors={neighbors} />
      ) : (
        <SongView
          key={slug}
          slug={song.slug}
          songId={song.id}
          title={song.title}
          artist={song.artist}
          isExample={song.is_example}
          unverified={song.unverified}
          verifiedAt={song.verified_at}
          chartText={song.chart_text}
          neighbors={neighbors}
        />
      )}
    </LocalNavProvider>
  );
}
