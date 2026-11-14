"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createSetlist, currentUserId, listMySetlists, saveSetlist, type SetlistSummary } from "@/lib/setlists/api";
import { saveDeviceSetlist, useDeviceSetlist } from "@/lib/setlists/device";
import { btn, gigDate, plain, primary } from "./ui";
import { OfflineNote } from "@/app/OfflineRoot";
import { useOffline } from "@/lib/offline/status";

type Me = { state: "loading" } | { state: "out" } | { state: "in"; lists: SetlistSummary[] } | { state: "error"; message: string };

export default function SetlistsHome() {
  const router = useRouter();
  const device = useDeviceSetlist();
  const [me, setMe] = useState<Me>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const offline = useOffline();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!(await currentUserId())) return alive && setMe({ state: "out" });
        const lists = await listMySetlists();
        if (alive) setMe({ state: "in", lists });
      } catch (e) {
        if (alive) setMe({ state: "error", message: (e as Error).message });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const make = async () => {
    setBusy(true);
    try {
      router.push(`/setlists/${await createSetlist("New setlist")}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  // Signed in with a device setlist left over: one tap moves it into the account.
  const moveDevice = async () => {
    if (!device) return;
    setBusy(true);
    try {
      const id = await createSetlist(device.name);
      await saveSetlist(id, { name: device.name, gig_date: device.gig_date, items: device.items.map((i) => ({ ...i, song: null })) });
      saveDeviceSetlist(null);
      router.push(`/setlists/${id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  const deviceCount = device?.items.length ?? 0;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-2">
      <Link href="/" className="inline-flex h-12 items-center text-lg text-bb-cue-gray active:text-bb-chart-white">
        ← All songs
      </Link>
      <h1 className="mb-3 text-bb-display">Setlists</h1>
      {err && <p className="bb-error mb-3 border border-bb-stop-red p-3 text-lg">{err}</p>}

      {me.state === "loading" && <p className="text-lg text-bb-cue-gray">Loading…</p>}
      {me.state === "error" && <p className="bb-error text-lg">Couldn&apos;t load your setlists: {me.message}</p>}

      {me.state === "out" && (
        <>
          <Link href="/setlists/device" className="mb-3 flex min-h-20 items-center justify-between gap-3 border-y border-bb-rule-gray bg-bb-case-charcoal px-4 py-3 active:bg-bb-rule-gray">
            <span className="min-w-0">
              <span className="block truncate text-xl font-semibold">{device?.name || "My setlist"}</span>
              <span className="block text-bb-cue-gray">
                {[gigDate(device?.gig_date ?? null), `${deviceCount} song${deviceCount === 1 ? "" : "s"}`, "on this device"].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className="text-2xl text-bb-cue-gray">›</span>
          </Link>
          <p className="text-lg text-bb-cue-gray">
            Signed out, you get one setlist saved on this device.{" "}
            <Link href="/login?next=/setlists" className="text-bb-chart-white underline">
              Sign in
            </Link>{" "}
            to keep as many as you like and share live links with the band.
          </p>
        </>
      )}

      {me.state === "in" && (
        <>
          {device && deviceCount > 0 && (
            <div className="bb-notice mb-4">
              <p className="mb-2 text-lg">
                You have a setlist saved on this device: <b>{device.name}</b> ({deviceCount} song{deviceCount === 1 ? "" : "s"}).
              </p>
              <button disabled={busy || offline} onClick={moveDevice} className={`${btn} ${plain}`}>
                Save to my account
              </button>
            </div>
          )}
          <button disabled={busy || offline} onClick={make} className={`${btn} ${primary} mb-4 h-14 w-full text-xl`}>
            + New setlist
          </button>
          {offline && <OfflineNote className="mb-4" />}
          {me.lists.length === 0 ? (
            <p className="text-lg text-bb-cue-gray">No setlists yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-bb-rule-gray border-y border-bb-rule-gray">
              {me.lists.map((l) => (
                <li key={l.id}>
                  <Link href={`/setlists/${l.id}`} className="flex min-h-20 items-center justify-between gap-3 bg-bb-case-charcoal px-4 py-3 active:bg-bb-rule-gray">
                    <span className="min-w-0">
                      <span className="block truncate text-xl font-semibold">{l.name}</span>
                      <span className="block text-bb-cue-gray">
                        {[gigDate(l.gig_date), `${l.count} song${l.count === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
                        {l.shared && <span className="bb-chip ml-2">Shared</span>}
                      </span>
                    </span>
                    <span className="text-2xl text-bb-cue-gray">›</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {me.state !== "loading" && (
        <p className="mt-6 text-base text-bb-cue-gray">Tip: add songs from search (+) or from any song page.</p>
      )}
    </main>
  );
}
