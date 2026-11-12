"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import AdminPdfLink from "./AdminPdfLink";
import Chart from "./Chart";
import { BpmToggle, DisplayControls, KeyInfo } from "./controls";
import { FONTS, useChartState, useGesture, useSongKeys, useSongNav, type Neighbors } from "./hooks";

export interface SongProps {
  slug: string;
  title: string;
  artist: string | null;
  isExample: boolean;
  chartText: string;
  neighbors: Neighbors;
}

export function enterFullscreen() {
  try {
    document.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {});
  } catch {
    // not supported (iPhone Safari): stage mode still works
  }
}

export default function SongView({ slug, title, artist, isExample, chartText, neighbors }: SongProps) {
  const s = useChartState(slug, chartText);
  const nav = useSongNav(slug, neighbors);
  const router = useRouter();
  const go = (d: -1 | 1) => {
    const t = d > 0 ? nav.next : nav.prev;
    if (t) router.push(`/songs/${t.slug}`);
  };
  useSongKeys(go);
  const gesture = useGesture({ onSwipe: go });
  useEffect(() => {
    if (nav.next) router.prefetch(`/songs/${nav.next.slug}`);
  }, [nav.next, router]);

  if (!s.view) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-4">
        <h1 className="mb-3 text-3xl font-bold">{title}</h1>
        <div className="rounded-xl border border-red-500 p-4">
          <p className="font-semibold">This chart has a format error.</p>
          <p className="text-muted">{s.error}</p>
          <pre className="mt-3 whitespace-pre-wrap font-mono text-lg">{chartText}</pre>
        </div>
      </main>
    );
  }
  const { meta } = s.view;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <Link href="/" className="inline-flex h-12 items-center text-lg text-muted active:text-foreground">
          ← All songs
        </Link>
        <Link
          href={`/songs/${slug}/stage`}
          onClick={enterFullscreen}
          className="inline-flex h-12 items-center gap-2 rounded-lg bg-accent px-5 text-lg font-bold text-black active:opacity-80"
        >
          Stage ▸
        </Link>
      </div>
      <header className="mb-1">
        <h1 className="text-3xl font-bold leading-tight">{title}</h1>
        <p className="text-lg text-muted">
          {artist}
          {isExample && (
            <span className="ml-2 rounded bg-accent/20 px-1.5 py-0.5 text-xs font-semibold uppercase text-accent">
              Example
            </span>
          )}
        </p>
      </header>

      <KeyInfo s={s}>
        <BpmToggle s={s} className="-mx-2" />
        {meta.time && <span>{meta.time}</span>}
        {meta.feel && <span>{meta.feel}</span>}
      </KeyInfo>

      <div className="sticky top-0 z-10 -mx-4 mb-4 flex flex-wrap items-center gap-2 border-b border-line bg-background/95 px-4 py-2 backdrop-blur">
        <DisplayControls s={s} />
      </div>

      <div {...gesture} className="touch-pan-y">
        <Chart view={s.view} chords={s.chords} fontFamily={FONTS[s.font].css} fontWeight={FONTS[s.font].weight} style={{ fontSize: "clamp(1.6rem, 7vw, 2.4rem)" }} />
      </div>

      <nav className="mt-10 grid grid-cols-2 gap-3" aria-label="Other songs">
        {nav.prev ? (
          <Link href={`/songs/${nav.prev.slug}`} className="flex min-h-14 flex-col justify-center rounded-xl border border-line bg-panel px-4 py-2">
            <span className="text-sm text-muted">‹ Previous</span>
            <span className="truncate text-lg font-semibold">{nav.prev.title}</span>
          </Link>
        ) : (
          <span />
        )}
        {nav.next && (
          <Link
            href={`/songs/${nav.next.slug}`}
            className="flex min-h-14 flex-col justify-center rounded-xl border border-line bg-panel px-4 py-2 text-right"
          >
            <span className="text-sm text-muted">Next ›</span>
            <span className="truncate text-lg font-semibold">{nav.next.title}</span>
          </Link>
        )}
      </nav>
      <p className="mt-3 text-center text-sm text-muted">Swipe, ← → or a page-turner pedal also changes song.</p>
      <AdminPdfLink />
    </main>
  );
}
