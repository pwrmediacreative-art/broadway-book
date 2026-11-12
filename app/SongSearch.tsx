"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { SongListItem } from "@/lib/supabase/server";

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, "");

export default function SongSearch({ songs }: { songs: SongListItem[] }) {
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return songs;
    return songs.filter((s) => {
      const hay = norm(`${s.title} ${s.artist ?? ""}`);
      return words.every((w) => hay.includes(w));
    });
  }, [q, songs]);

  return (
    <>
      <label htmlFor="search" className="sr-only">
        Search songs
      </label>
      <input
        id="search"
        type="search"
        inputMode="search"
        autoComplete="off"
        placeholder="Search title or artist"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="sticky top-2 z-10 mb-4 h-14 w-full rounded-xl border border-line bg-panel px-4 text-xl text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
      />
      <p className="mb-2 text-sm text-muted" aria-live="polite">
        {results.length} {results.length === 1 ? "song" : "songs"}
      </p>
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
        {results.map((s) => (
          <li key={s.slug}>
            <Link
              href={`/songs/${s.slug}`}
              className="flex min-h-16 items-center justify-between gap-3 bg-panel px-4 py-3 active:bg-line"
            >
              <span className="min-w-0">
                <span className="block truncate text-xl font-semibold">{s.title}</span>
                <span className="block truncate text-muted">
                  {s.artist}
                  {s.is_example && (
                    <span className="ml-2 rounded bg-accent/20 px-1.5 py-0.5 text-xs font-semibold uppercase text-accent">
                      Example
                    </span>
                  )}
                </span>
              </span>
              {s.key && <span className="shrink-0 font-mono text-2xl font-bold text-accent">{s.key}</span>}
            </Link>
          </li>
        ))}
        {results.length === 0 && <li className="bg-panel px-4 py-6 text-center text-muted">No songs match.</li>}
      </ul>
    </>
  );
}
