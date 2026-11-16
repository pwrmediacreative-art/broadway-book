"use client";

// Home search: your own uploaded charts that match, above the library results. They come
// from your account (or this phone's copy of it), never from the public search index.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { isOffline } from "@/lib/offline/status";
import { savedMineList, syncMine, type MineChart } from "@/lib/upload/mine";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function matchMine(list: MineChart[], q: string): MineChart[] {
  const words = norm(q).split(" ").filter(Boolean);
  if (!words.length) return [];
  return list.filter((c) => {
    const hay = norm(`${c.title} ${c.artist ?? ""}`);
    return words.every((w) => hay.includes(w));
  });
}

export default function MineResults({ q }: { q: string }) {
  const [list, setList] = useState<MineChart[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setList(await savedMineList());
        if (!isOffline()) {
          await syncMine();
          if (alive) setList(await savedMineList());
        }
      } catch {
        // signed out, storage blocked or offline: nothing to add
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  const hits = useMemo(() => matchMine(list, q).slice(0, 10), [list, q]);
  if (!hits.length) return null;
  return (
    <ul className="mb-3 divide-y divide-bb-rule-gray border-y border-bb-rule-gray" aria-label="Your uploads">
      {hits.map((c) => (
        <li key={c.id}>
          <Link href={`/mine/${c.id}`} className="flex min-h-14 items-center gap-3 bg-bb-case-charcoal px-4 py-3 active:bg-bb-rule-gray">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xl font-semibold">{c.title}</span>
              {c.artist && <span className="block truncate text-base text-bb-cue-gray">{c.artist}</span>}
            </span>
            <span className="bb-chip shrink-0">Yours</span>
            {c.key && <span className="shrink-0 font-bb-data text-xl font-bold">{c.key}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}
