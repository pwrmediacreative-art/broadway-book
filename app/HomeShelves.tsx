"use client";

// Home, under the search box: a "Recent" row (songs opened on this phone), a "My uploads"
// row (your uploaded charts, newest first) and a "Made by me" row (charts you made in the
// editor, newest first, with + New chart). Each is one line of tiles you swipe sideways;
// a row with nothing in it isn't shown (signed in, New chart always is). The full song list follows below.
import Link from "next/link";
import { useNavMe } from "@/lib/nav/me";
import { PREF, setPref } from "@/lib/prefs";
import type { SongDoc } from "@/lib/search/pack";
import type { MineChart } from "@/lib/upload/mine";

const RECENT_SHOWN = 20;

interface Tile {
  key: string;
  href: string;
  title: string;
  sub: string | null;
  songKey: string | null;
  onClick?: () => void;
}

export default function HomeShelves({
  recent,
  bySlug,
  mine,
}: {
  recent: Map<string, number>;
  bySlug: Map<string, SongDoc>;
  mine: MineChart[];
}) {
  const me = useNavMe();
  const recentDocs = [...recent.keys()]
    .map((s) => bySlug.get(s))
    .filter((d): d is SongDoc => !!d)
    .slice(0, RECENT_SHOWN);
  // Next/previous in the chart follows the row you opened it from.
  const openRecent = () =>
    setPref(PREF.nav, JSON.stringify(recentDocs.map((d) => ({ slug: d.slug, title: d.title }))), "session");
  const yours = mine.filter((c) => c.mine !== false && !c.made);
  const made = mine.filter((c) => c.mine !== false && c.made);

  return (
    <>
      {recentDocs.length > 0 && (
        <Shelf
          title="Recent"
          tiles={recentDocs.map((d) => ({ key: d.slug, href: `/songs/${d.slug}`, title: d.title, sub: d.artist, songKey: d.key, onClick: openRecent }))}
        />
      )}
      {yours.length > 0 && (
        <Shelf
          title="My uploads"
          more={me?.upload ? { href: "/upload", label: "Upload" } : undefined}
          tiles={yours.map((c) => ({ key: c.id, href: `/mine/${c.id}`, title: c.title, sub: c.artist, songKey: c.key }))}
        />
      )}
      {made.length > 0 ? (
        <Shelf
          title="Made by me"
          more={{ href: "/make", label: "New chart" }}
          tiles={made.map((c) => ({ key: c.id, href: `/mine/${c.id}`, title: c.title, sub: c.locked ? "Waiting for votes" : c.artist, songKey: c.key }))}
        />
      ) : (
        me && (
          <Link href="/make" className="bb-btn bb-btn-secondary mb-4 h-12 w-full px-4 text-lg font-semibold lg:w-auto">
            + New chart
          </Link>
        )
      )}
    </>
  );
}

function Shelf({ title, tiles, more }: { title: string; tiles: Tile[]; more?: { href: string; label: string } }) {
  return (
    <section aria-label={title} className="mb-4">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        {more && (
          <Link href={more.href} className="inline-flex h-11 items-center px-1 text-base text-bb-cue-gray active:text-bb-chart-white">
            + {more.label}
          </Link>
        )}
      </div>
      <ul className="-mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:scroll-px-0 lg:px-0">
        {tiles.map((t) => (
          <li key={t.key} className="shrink-0 snap-start">
            <Link
              href={t.href}
              onClick={t.onClick}
              className="flex h-16 w-48 flex-col justify-center gap-0.5 bg-bb-case-charcoal px-3 active:bg-bb-rule-gray"
            >
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-lg font-semibold leading-tight">{t.title}</span>
                {t.songKey && <span className="shrink-0 font-bb-data text-base font-bold">{t.songKey}</span>}
              </span>
              {t.sub && <span className="truncate text-sm text-bb-cue-gray">{t.sub}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
