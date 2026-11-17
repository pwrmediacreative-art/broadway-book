"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { pretty } from "@/lib/chart";
import { spotLabel } from "@/lib/flags/ref";
import { useAllFlags } from "@/lib/flags/store";
import { dayLabel, flagHref, groupNotes, type NoteFilter } from "@/lib/notes/group";
import { isStale, useMyVersions } from "@/lib/personal/versions";
import { useSongIndex } from "@/lib/search/useIndex";

const FILTERS: Record<NoteFilter, string> = { all: "All", flags: "Flags", versions: "My versions" };

export default function NotesView() {
  const { ready, flags } = useAllFlags();
  const mine = useMyVersions();
  const { docs } = useSongIndex();
  const [filter, setFilter] = useState<NoteFilter>("all");

  // Flags on songs that aren't in the song list any more (unpublished or removed) are kept
  // apart: no dead links.
  const { groups, gone } = useMemo(() => {
    const bySlug = new Map((docs ?? []).map((d) => [d.slug, d]));
    const live = flags.filter((f) => bySlug.has(f.slug));
    const versions = mine.list.map((v) => ({ slug: v.slug, title: v.title, artist: v.artist, updated_at: v.updated_at, stale: isStale(v) }));
    return { groups: groupNotes(live, versions, (slug) => bySlug.get(slug) ?? null, filter), gone: flags.length - live.length };
  }, [flags, mine.list, docs, filter]);

  if (!ready || !mine.ready || !docs) return <p className="text-lg text-bb-cue-gray">Loading…</p>;
  const nothing = !flags.length && !mine.list.length;

  let lastDay = "";
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Show">
        {(Object.keys(FILTERS) as NoteFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`bb-btn h-11 px-4 text-base ${filter === f ? "bb-btn-primary" : "bb-btn-secondary"}`}
          >
            {FILTERS[f]}
          </button>
        ))}
      </div>
      {nothing ? (
        <p className="text-lg text-bb-cue-gray">
          Nothing yet. On any chart, press and hold a chord to flag it, or use “Suggest a change”, then “Just for me”, to keep your own version.
        </p>
      ) : groups.length === 0 ? (
        <p className="text-lg text-bb-cue-gray">Nothing here with this filter.</p>
      ) : (
        groups.map((g) => {
          const day = g.latest ? dayLabel(g.latest) : "";
          const head = day !== lastDay;
          lastDay = day;
          return (
            <section key={g.slug} aria-label={g.title}>
              {head && day && <h2 className="mb-1 mt-5 text-sm font-semibold uppercase tracking-wide text-bb-cue-gray">{day}</h2>}
              <div className="border-t border-bb-rule-gray pb-2 pt-3">
                <h3 className="text-xl font-bold leading-tight">
                  <Link href={`/songs/${g.slug}`} className="active:text-bb-downbeat-amber">
                    {g.title}
                  </Link>
                </h3>
                {g.artist && <p className="text-base text-bb-cue-gray">{g.artist}</p>}
                <ul className="mt-2 flex flex-col gap-2">
                  {g.version && (
                    <li>
                      <Link href={`/songs/${g.slug}`} className="flex min-h-12 items-center gap-3 border border-bb-rule-gray bg-bb-case-charcoal px-3 py-2 active:bg-bb-rule-gray">
                        <span className="text-lg font-bold" aria-hidden>
                          ✎
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-lg">Your version</span>
                          <span className="block text-sm text-bb-cue-gray">
                            edited {dayLabel(g.version.updated_at)}
                            {g.version.stale ? " · the public chart changed since" : ""}
                          </span>
                        </span>
                        <span className="text-2xl text-bb-cue-gray" aria-hidden>
                          ›
                        </span>
                      </Link>
                    </li>
                  )}
                  {g.flags.map((f) => (
                    <li key={f.id}>
                      <Link href={flagHref(f)} className="flex min-h-12 items-center gap-3 border border-bb-rule-gray bg-bb-case-charcoal px-3 py-2 active:bg-bb-rule-gray">
                        <span className="shrink-0 font-bb-data text-lg font-bold text-bb-downbeat-amber">{spotLabel(f.ref, f.ref.beat > 0)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-bb-data text-lg">{pretty(f.ref.text)}</span>
                          {f.note && <span className="block text-sm text-bb-cue-gray">“{f.note}”</span>}
                        </span>
                        <span className="text-2xl text-bb-cue-gray" aria-hidden>
                          ›
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          );
        })
      )}
      {gone > 0 && filter !== "versions" && (
        <p className="mt-6 text-base text-bb-cue-gray">
          {gone} flag{gone === 1 ? " is" : "s are"} on songs that aren’t in the library any more.
        </p>
      )}
    </>
  );
}
