"use client";

// Home page: uploaded charts you can open (yours; every admin's if you're an admin), above
// search results and as an "Uploads" row in A–Z. They come from your account (or this
// phone's copy of it), never from the public search index.
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

function Row({ c }: { c: MineChart }) {
  return (
    <li>
      <Link href={`/mine/${c.id}`} className="flex min-h-14 items-center gap-3 bg-bb-case-charcoal px-4 py-3 active:bg-bb-rule-gray">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xl font-semibold">{c.title}</span>
          <span className="block truncate text-base text-bb-cue-gray">
            {[c.artist, c.mine === false ? `uploaded by ${c.by ?? "another admin"}` : null].filter(Boolean).join(" · ")}
          </span>
        </span>
        <span className="bb-chip shrink-0">{c.mine === false ? "Uploaded" : "Yours"}</span>
        {c.key && <span className="shrink-0 font-bb-data text-xl font-bold">{c.key}</span>}
      </Link>
    </li>
  );
}

/**
 * q set: uploads matching the search, above the results.
 * all: an "Uploads" row at the top of the A–Z list that opens every upload you can see.
 */
export default function MineResults({ q, all = false }: { q: string; all?: boolean }) {
  const [list, setList] = useState<MineChart[]>([]);
  const [open, setOpen] = useState(false);
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
  const sorted = useMemo(() => [...list].sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" })), [list]);
  if (all) {
    if (!list.length) return null;
    return (
      <div className="mb-3 border-y border-bb-rule-gray">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-h-14 w-full items-center justify-between gap-3 bg-bb-case-charcoal px-4 py-3 text-left active:bg-bb-rule-gray"
        >
          <span className="text-xl font-semibold">Uploads</span>
          <span className="text-lg text-bb-cue-gray">
            {list.length} {open ? "▴" : "▾"}
          </span>
        </button>
        {open && (
          <ul className="divide-y divide-bb-rule-gray border-t border-bb-rule-gray" aria-label="Uploads">
            {sorted.map((c) => (
              <Row key={c.id} c={c} />
            ))}
          </ul>
        )}
      </div>
    );
  }
  if (!hits.length) return null;
  return (
    <ul className="mb-3 divide-y divide-bb-rule-gray border-y border-bb-rule-gray" aria-label="Uploads">
      {hits.map((c) => (
        <Row key={c.id} c={c} />
      ))}
    </ul>
  );
}
