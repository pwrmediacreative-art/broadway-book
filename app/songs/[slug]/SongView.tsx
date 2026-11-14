"use client";

import Link from "next/link";
import AddToSetlist from "@/app/setlists/AddToSetlist";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AdminPdfLink from "./AdminPdfLink";
import Chart from "./Chart";
import { BpmToggle, DisplayControls, KeyInfo } from "./controls";
import { FONTS, useChartState, useGesture, useSongKeys, useSongNav, type Neighbors } from "./hooks";
import { recordRecent } from "@/lib/search/recent";
import { usePickedChart } from "@/lib/personal/versions";
import { checkedDate } from "@/lib/review/queue";
import { useGo, useLocalNav } from "@/lib/offline/nav";
import { OpenBadge, PersonalBar, SongActions, useOpenCount } from "./Community";
import { HoldSheet, MoveFlagsBanner, MyFlags, useHold, useHoldMarks, withHold, type Spot } from "./Hold";

export interface SongProps {
  slug: string;
  songId: string;
  title: string;
  artist: string | null;
  isExample: boolean;
  unverified?: boolean;
  /** When an admin checked this exact chart against the original (null: not verified). */
  verifiedAt?: string | null;
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

export function UnverifiedBadge({ className = "" }: { className?: string }) {
  return (
    <span
      title="Not checked against the original chart yet. Flag it or suggest a fix if something's off."
      data-unverified-badge
      className={`rounded bg-amber-400/20 px-1.5 py-0.5 text-xs font-semibold uppercase text-amber-200 ${className}`}
    >
      Unverified
    </span>
  );
}

/** Small calm "Verified" mark. Tap it to see when the chart was checked. */
function VerifiedBadge({ at }: { at?: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="ml-2 inline-flex min-h-11 items-center align-middle"
        data-verified-badge
      >
        <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 text-xs font-semibold uppercase text-emerald-200">✓ Verified</span>
      </button>
      {open && (
        <span role="status" className="block text-base text-bb-cue-gray">
          Checked against the original{at ? ` on ${checkedDate(at)}` : ""}.
        </span>
      )}
    </>
  );
}

export default function SongView({ slug, songId, title, artist, isExample, unverified, verifiedAt, chartText, neighbors }: SongProps) {
  // The signed-in player's own version replaces the public chart (they can flip back).
  const pick = usePickedChart(slug, chartText);
  const openCount = useOpenCount(songId);
  const s = useChartState(slug, pick.text);
  const nav = useSongNav(slug, neighbors);
  useEffect(() => recordRecent(slug), [slug]);
  const router = useRouter();
  const goTo = useGo();
  const local = useLocalNav(); // saved-chart page: songs change in place, nothing to warm up
  const [spot, setSpot] = useState<Spot | null>(null);
  const go = (d: -1 | 1) => {
    setSpot(null);
    const t = d > 0 ? nav.next : nav.prev;
    if (t) goTo(`/songs/${t.slug}`);
  };
  useSongKeys(go, (e) => {
    if (e.key !== "Escape" || !spot) return false;
    setSpot(null);
    return true;
  });
  // Press and hold a chord: flag it or suggest an edit. A hold never counts as a swipe.
  const hold = useHold(s.view, s.chords, setSpot);
  const marks = useHoldMarks(slug, s.view, spot);
  const gesture = withHold(useGesture({ onSwipe: (d) => !hold.held() && go(d) }), hold.handlers);
  useEffect(() => {
    if (nav.next && !local) router.prefetch(`/songs/${nav.next.slug}`);
  }, [nav.next, router, local]);

  if (!s.view) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-4">
        <h1 className="mb-3 text-3xl font-bold">{title}</h1>
        <div className="rounded-xl border border-red-500 p-4">
          <p className="font-semibold">This chart has a format error.</p>
          <p className="text-bb-cue-gray">{s.error}</p>
          <pre className="mt-3 whitespace-pre-wrap font-mono text-lg">{pick.text}</pre>
        </div>
        <PersonalBar slug={slug} songId={songId} pick={pick} publicText={chartText} />
        <SongActions slug={slug} songId={songId} pick={pick} />
      </main>
    );
  }
  const { meta } = s.view;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <Link href="/" className="inline-flex h-12 items-center text-lg text-bb-cue-gray active:text-bb-chart-white">
          ← All songs
        </Link>
        <div className="flex items-center gap-2">
        <AddToSetlist slug={slug} title={title} variant="button" />
        <Link
          href={`/songs/${slug}/stage`}
          onClick={enterFullscreen}
          className="inline-flex h-12 items-center gap-2 rounded-lg bg-bb-downbeat-amber px-5 text-lg font-bold text-bb-stage-black active:opacity-80"
        >
          Stage ▸
        </Link>
        </div>
      </div>
      <header className="mb-1">
        <h1 className="text-3xl font-bold leading-tight">{title}</h1>
        <p className="text-lg text-bb-cue-gray">
          {artist}
          {isExample && (
            <span className="ml-2 rounded bg-bb-downbeat-amber/20 px-1.5 py-0.5 text-xs font-semibold uppercase text-bb-downbeat-amber">
              Example
            </span>
          )}
          {/* Examples sit outside verification: they only carry the Example badge. */}
          {!isExample && (unverified ? <UnverifiedBadge className="ml-2" /> : <VerifiedBadge at={verifiedAt} />)}
          <OpenBadge slug={slug} count={openCount} />
        </p>
        {!isExample && unverified && (
          <p className="mt-1 text-base text-bb-cue-gray" data-unverified-note>
            Not yet checked against the original. Play it by ear and{" "}
            <a href="#suggest" className="text-bb-downbeat-amber underline">
              suggest a fix
            </a>{" "}
            if something is off.
          </p>
        )}
      </header>
      <PersonalBar slug={slug} songId={songId} pick={pick} publicText={chartText} />
      <MoveFlagsBanner slug={slug} />

      <KeyInfo s={s}>
        <BpmToggle s={s} className="-mx-2" />
        {meta.time && <span>{meta.time}</span>}
        {meta.feel && <span>{meta.feel}</span>}
      </KeyInfo>

      <div className="sticky top-0 z-10 -mx-4 mb-4 flex flex-wrap items-center gap-2 border-b border-bb-rule-gray bg-bb-house-black/95 px-4 py-2 backdrop-blur">
        <DisplayControls s={s} />
      </div>

      <div {...gesture} className="touch-pan-y">
        <Chart view={s.view} chords={s.chords} fontFamily={FONTS[s.font].css} fontWeight={FONTS[s.font].weight} style={{ fontSize: "clamp(1.6rem, 7vw, 2.4rem)" }} hold={marks} />
      </div>
      {spot && (
        <HoldSheet
          slug={slug}
          spot={spot}
          onMine={pick.usingMine}
          onClose={() => setSpot(null)}
          onSwipe={(d) => go(d)}
        />
      )}
      <MyFlags slug={slug} view={s.view} />

      <SongActions slug={slug} songId={songId} pick={pick} />

      <nav className="mt-10 grid grid-cols-2 gap-3" aria-label="Other songs">
        {nav.prev ? (
          <Link href={`/songs/${nav.prev.slug}`} className="flex min-h-14 flex-col justify-center rounded-xl border border-bb-rule-gray bg-bb-case-charcoal px-4 py-2">
            <span className="text-sm text-bb-cue-gray">‹ Previous</span>
            <span className="truncate text-lg font-semibold">{nav.prev.title}</span>
          </Link>
        ) : (
          <span />
        )}
        {nav.next && (
          <Link
            href={`/songs/${nav.next.slug}`}
            className="flex min-h-14 flex-col justify-center rounded-xl border border-bb-rule-gray bg-bb-case-charcoal px-4 py-2 text-right"
          >
            <span className="text-sm text-bb-cue-gray">Next ›</span>
            <span className="truncate text-lg font-semibold">{nav.next.title}</span>
          </Link>
        )}
      </nav>
      <p className="mt-3 text-center text-sm text-bb-cue-gray">Swipe, ← → or a page-turner pedal also changes song.</p>
      <AdminPdfLink />
    </main>
  );
}
