"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { loadSongs } from "@/lib/setlists/api";
import { saveDeviceSetlist, useDeviceSetlist } from "@/lib/setlists/device";
import type { PlaySet, SetItem } from "@/lib/setlists/play";
import { decodeSnapshot, encodeSnapshot, type Snapshot } from "@/lib/setlists/snapshot";
import { CopyButton } from "./AccountSetlist";
import Editor from "./Editor";
import PlayView from "./PlayView";
import { btn, enterFullscreen, gigDate, plain, primary, SetSongList } from "./ui";

/** Device/snapshot items + charts for them, in ONE request (songs_bundle). */
function useFilled(snap: Snapshot | null | undefined) {
  const [set, setSet] = useState<PlaySet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sig = snap ? JSON.stringify(snap.items.map((i) => i.slug)) : null;
  useEffect(() => {
    if (!snap) return;
    let alive = true;
    loadSongs(snap.items.map((i) => i.slug))
      .then((songs) => {
        if (!alive) return;
        const items: SetItem[] = snap.items.map((i) => ({ ...i, song: songs.get(i.slug) ?? null }));
        setSet({ name: snap.name, gig_date: snap.gig_date, items });
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
    // Load once per song list; name/note edits don't need new charts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return { set, error };
}

const EMPTY: Snapshot = { name: "My setlist", gig_date: null, items: [] };
const toSnap = (s: PlaySet): Snapshot => ({
  name: s.name,
  gig_date: s.gig_date,
  items: s.items.flatMap((i) => (i.slug ? [{ slug: i.slug, key: i.key, note: i.note }] : [])),
});

function Loading({ error }: { error?: string | null }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-2">
      <Link href="/setlists" className="inline-flex h-12 items-center text-lg text-muted active:text-foreground">
        ← Setlists
      </Link>
      <p className="mt-4 text-xl">{error ? `Couldn't load: ${error}` : "Loading…"}</p>
    </main>
  );
}

/** The signed-out player's one setlist, kept on this device. */
export function DeviceEditor() {
  const device = useDeviceSetlist();
  if (device === undefined) return <Loading />;
  return <DeviceEditorInner device={device ?? EMPTY} />;
}

function DeviceEditorInner({ device }: { device: Snapshot }) {
  // Read once on open; the editor owns the state after that.
  const [start] = useState(device);
  const { set, error } = useFilled(start);
  const save = useCallback(async (s: PlaySet) => saveDeviceSetlist(toSnap(s)), []);
  const [link, setLink] = useState<string | null>(null);
  if (!set) return <Loading error={error} />;
  return (
    <Editor
      initial={set}
      save={save}
      playHref="/setlists/device/play"
      share={(cur) => (
        <section className="mb-6 rounded-xl border border-line p-3">
          <h2 className="mb-1 text-lg font-semibold">Share with the band</h2>
          <p className="mb-2 text-base text-muted">
            Makes a snapshot link of the list as it is now: songs, keys, notes, name and date. Later changes need a new link, and a snapshot link can&apos;t be turned
            off.{" "}
            <Link href="/login?next=/setlists" className="text-accent underline">
              Sign in
            </Link>{" "}
            for a live link you can turn off.
          </p>
          {link && <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Snapshot link" className="mb-2 h-12 w-full rounded-lg border border-line bg-background px-3 font-mono text-base" />}
          <div className="flex flex-wrap gap-2">
            <button
              className={`${btn} ${link ? plain : primary}`}
              onClick={() => setLink(`${location.origin}/setlists/snapshot#${encodeSnapshot(toSnap(cur))}`)}
            >
              {link ? "Update link" : "Make snapshot link"}
            </button>
            {link && <CopyButton text={link} />}
          </div>
        </section>
      )}
      danger={
        <section className="rounded-xl border border-red-500/50 p-3">
          <ClearButton />
        </section>
      }
    />
  );
}

function ClearButton() {
  const router = useRouter();
  return (
    <button
      className={`${btn} border border-red-500/60 text-red-300 active:bg-red-500/20`}
      onClick={() => {
        if (!window.confirm("Clear this setlist from this device? This can't be undone.")) return;
        saveDeviceSetlist(null);
        router.push("/setlists");
      }}
    >
      Clear setlist
    </button>
  );
}

export function DevicePlay() {
  const device = useDeviceSetlist();
  const { set, error } = useFilled(device === undefined ? undefined : (device ?? EMPTY));
  if (!set) return <Loading error={error} />;
  return <PlayView set={set} id="device" exitHref="/setlists/device" />;
}

/** A snapshot link: the list rides in the URL hash. View-only; play mode on the same page. */
export function SnapshotView() {
  const [snap, setSnap] = useState<Snapshot | null | undefined>(undefined);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const read = () => setSnap(decodeSnapshot(location.hash) ?? null);
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const { set, error } = useFilled(snap);
  if (snap === null)
    return (
      <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-2">
        <p className="mt-4 text-xl">This snapshot link is incomplete or broken. Ask for a new link.</p>
      </main>
    );
  if (!set) return <Loading error={error} />;
  if (playing) return <PlayView set={set} id={`snap.${location.hash.slice(1, 40)}`} onExit={() => setPlaying(false)} />;
  const playable = set.items.filter((i) => i.song).length;
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-2">
      <Link href="/" className="inline-flex h-12 items-center text-lg text-muted active:text-foreground">
        ← All songs
      </Link>
      <h1 className="text-3xl font-bold leading-tight">{set.name}</h1>
      <p className="mb-3 text-lg text-muted">
        {[gigDate(set.gig_date), `${playable} song${playable === 1 ? "" : "s"}`, "snapshot"].filter(Boolean).join(" · ")}
      </p>
      <button
        disabled={!playable}
        onClick={() => {
          enterFullscreen();
          setPlaying(true);
        }}
        className={`${btn} ${primary} mb-4 h-14 w-full text-xl disabled:opacity-40`}
      >
        Play set ▸
      </button>
      <SetSongList items={set.items} />
      <p className="mt-4 text-base text-muted">Snapshot of a setlist. If the list changed, ask for a new link.</p>
    </main>
  );
}
