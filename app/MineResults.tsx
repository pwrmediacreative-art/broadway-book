"use client";

// Home page: uploaded charts you can open (yours; every admin's if you're an admin): the
// "My uploads" row, the "Uploaded" filter, and matches above search results. They come from
// your account (or this phone's copy of it), never from the public search index.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { isOffline } from "@/lib/offline/status";
import type { SongDoc } from "@/lib/search/pack";
import { newestFirst, savedMineList, syncMine, type MineChart } from "@/lib/upload/mine";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function matchMine(list: MineChart[], q: string): MineChart[] {
  const words = norm(q).split(" ").filter(Boolean);
  if (!words.length) return [];
  return list.filter((c) => {
    const hay = norm(`${c.title} ${c.artist ?? ""}`);
    return words.every((w) => hay.includes(w));
  });
}

const header = (text: string, name: string) => text.match(new RegExp(`\\{${name}:\\s*([^}]+)\\}`))?.[1]?.trim() ?? null;

/** An upload as a search document, so the same filters and sorts apply to it. */
export function mineDoc(c: MineChart): SongDoc {
  const bpm = Number(header(c.chart_text, "bpm"));
  return {
    slug: c.slug,
    title: c.title,
    artist: c.artist,
    key: c.key,
    bpm: Number.isFinite(bpm) && bpm > 0 ? bpm : null,
    time: header(c.chart_text, "time"),
    feel: header(c.chart_text, "feel"),
    tags: [],
    ex: false,
    uv: false,
  };
}

/** Uploads you can open, newest first: this phone's copy first, then fresh from your account. */
export function useMineCharts(): MineChart[] {
  const [list, setList] = useState<MineChart[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const saved = await savedMineList();
        if (alive) setList(newestFirst(saved));
        if (!isOffline()) {
          await syncMine();
          const fresh = await savedMineList();
          if (alive) setList(newestFirst(fresh));
        }
      } catch {
        // signed out, storage blocked or offline: nothing to add
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return list;
}

export function MineRow({ c, id }: { c: MineChart; id?: string }) {
  return (
    <li id={id} className="scroll-mt-20">
      <Link href={`/mine/${c.id}`} className="flex min-h-16 items-center gap-3 bg-bb-case-charcoal px-4 py-3 active:bg-bb-rule-gray">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xl font-semibold">{c.title}</span>
          <span className="block truncate text-base text-bb-cue-gray">
            {[c.artist, c.mine === false ? `${c.made ? "made" : "uploaded"} by ${c.by ?? "another admin"}` : null].filter(Boolean).join(" · ")}
          </span>
        </span>
        <span className="bb-chip shrink-0">{c.mine === false ? (c.made ? "Made" : "Uploaded") : "Yours"}</span>
        {c.key && <span className="shrink-0 font-bb-data text-2xl font-bold">{c.key}</span>}
      </Link>
    </li>
  );
}

/** Uploads matching the search, above the results. */
export default function MineResults({ list, q }: { list: MineChart[]; q: string }) {
  const hits = useMemo(() => matchMine(list, q).slice(0, 10), [list, q]);
  if (!hits.length) return null;
  return (
    <ul className="mb-3 divide-y divide-bb-rule-gray border-y border-bb-rule-gray" aria-label="Uploads">
      {hits.map((c) => (
        <MineRow key={c.id} c={c} />
      ))}
    </ul>
  );
}
