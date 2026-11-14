"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { addToSetlist, createSetlist, currentUserId, listMySetlists, type SetlistSummary } from "@/lib/setlists/api";
import { addToDeviceSetlist, useDeviceSetlist } from "@/lib/setlists/device";
import { MAX_SONGS } from "@/lib/setlists/play";
import { btn, gigDate, plain, primary } from "./ui";
import { OfflineNote } from "@/app/OfflineRoot";
import { useOffline } from "@/lib/offline/status";

/** "Add to setlist": a trigger + a picker sheet (your setlists, or New setlist; signed out: the device list). */
export default function AddToSetlist({ slug, title, variant }: { slug: string; title: string; variant: "row" | "button" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {variant === "row" ? (
        <button
          onClick={() => setOpen(true)}
          aria-label={`Add ${title} to a setlist`}
          title="Add to setlist"
          className="flex w-14 shrink-0 items-center justify-center border-l border-bb-rule-gray text-3xl text-bb-cue-gray active:bg-bb-rule-gray active:text-bb-chart-white"
        >
          +
        </button>
      ) : (
        <button onClick={() => setOpen(true)} className={`${btn} ${plain} h-12 px-3 text-base`}>
          + Setlist
        </button>
      )}
      {open && <Picker slug={slug} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}

type Who = { state: "loading" } | { state: "out" } | { state: "in"; lists: SetlistSummary[] } | { state: "error"; message: string };

function Picker({ slug, title, onClose }: { slug: string; title: string; onClose: () => void }) {
  const device = useDeviceSetlist();
  const [who, setWho] = useState<Who>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ name: string; href: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const offline = useOffline();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!(await currentUserId())) return alive && setWho({ state: "out" });
        const lists = await listMySetlists();
        if (alive) setWho({ state: "in", lists });
      } catch (e) {
        if (alive) setWho({ state: "error", message: (e as Error).message });
      }
    })();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const run = async (fn: () => Promise<{ name: string; href: string }>) => {
    setBusy(true);
    setErr(null);
    try {
      setDone(await fn());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const toList = (l: SetlistSummary) =>
    run(async () => {
      if (l.count >= MAX_SONGS) throw new Error(`${l.name} is full (${MAX_SONGS} songs).`);
      await addToSetlist(l.id, slug);
      return { name: l.name, href: `/setlists/${l.id}` };
    });
  const toNew = (name: string) =>
    run(async () => {
      const id = await createSetlist(name);
      await addToSetlist(id, slug);
      return { name: name.trim() || "New setlist", href: `/setlists/${id}` };
    });
  const toDevice = () =>
    run(async () => {
      if (!addToDeviceSetlist(slug)) throw new Error(`Your setlist is full (${MAX_SONGS} songs).`);
      return { name: device?.name || "My setlist", href: "/setlists/device" };
    });

  const row = "flex min-h-14 w-full items-center justify-between gap-3 bg-bb-case-charcoal px-4 py-2 text-left active:bg-bb-rule-gray";

  return (
    <div className="fixed inset-0 z-[70] flex items-end bg-bb-stage-black/80 sm:items-center sm:justify-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`Add ${title} to a setlist`}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85dvh] w-full overflow-y-auto rounded-bb-none border-t border-bb-rule-gray bg-bb-house-black p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-md sm:border"
      >
        <div className="mb-3 flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-xl font-bold">Add “{title}”</h2>
          <button onClick={onClose} aria-label="Close" className="bb-btn bb-btn-quiet size-11 p-0 text-2xl text-bb-cue-gray">
            ✕
          </button>
        </div>

        {done ? (
          <>
            <p className="mb-3 text-xl text-bb-chart-white" aria-live="polite">
              ✓ Added to {done.name}
            </p>
            <div className="flex gap-2">
              <Link href={done.href} className={`${btn} ${plain} flex-1`}>
                Open setlist
              </Link>
              <button onClick={onClose} className={`${btn} ${primary} flex-1`}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            {err && <p className="bb-error mb-3 border border-bb-stop-red p-3 text-lg">{err}</p>}
            {who.state === "loading" && <p className="text-lg text-bb-cue-gray">Loading…</p>}
            {who.state === "error" && <p className="bb-error text-lg">{who.message}</p>}
            {who.state === "out" && (
              <>
                <button disabled={busy} onClick={toDevice} className={`${row} mb-3 border-y border-bb-rule-gray`}>
                  <span className="min-w-0">
                    <span className="block truncate text-lg font-semibold">{device?.name || "My setlist"}</span>
                    <span className="block text-sm text-bb-cue-gray">On this device · {device?.items.length ?? 0} songs</span>
                  </span>
                  <span className="text-2xl text-bb-chart-white">+</span>
                </button>
                <p className="text-base text-bb-cue-gray">
                  <Link href="/login?next=/setlists" className="text-bb-chart-white underline">
                    Sign in
                  </Link>{" "}
                  for more setlists and live share links.
                </p>
              </>
            )}
            {who.state === "in" && offline && <OfflineNote />}
            {who.state === "in" && !offline && (
              <ul className="flex flex-col divide-y divide-bb-rule-gray border-y border-bb-rule-gray">
                <li>
                  {newName === null ? (
                    <button disabled={busy} onClick={() => setNewName("")} className={row}>
                      <span className="text-lg font-semibold">+ New setlist</span>
                    </button>
                  ) : (
                    <form
                      className="flex gap-2 py-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void toNew(newName);
                      }}
                    >
                      <input
                        autoFocus
                        value={newName}
                        maxLength={100}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="Setlist name"
                        aria-label="New setlist name"
                        className="bb-input h-12 min-w-0 flex-1 bg-bb-case-charcoal px-3 text-lg"
                      />
                      <button disabled={busy} className={`${btn} ${primary}`}>
                        Create
                      </button>
                    </form>
                  )}
                </li>
                {who.lists.map((l) => (
                  <li key={l.id}>
                    <button disabled={busy} onClick={() => toList(l)} className={row}>
                      <span className="min-w-0">
                        <span className="block truncate text-lg font-semibold">{l.name}</span>
                        <span className="block text-sm text-bb-cue-gray">{[gigDate(l.gig_date), `${l.count} songs`].filter(Boolean).join(" · ")}</span>
                      </span>
                      <span className="text-2xl text-bb-chart-white">+</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
