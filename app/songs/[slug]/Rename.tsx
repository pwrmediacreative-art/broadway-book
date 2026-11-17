"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { OfflineNote } from "@/app/OfflineRoot";
import { useOffline } from "@/lib/offline/status";
import { rememberedUser } from "@/lib/offline/user";
import { findSameName } from "@/lib/songs/dupName";
import { renameSong } from "./rename-actions";

type Same = { slug: string; title: string; artist: string | null };

const noop = () => () => {};
/** Is the player remembered on this phone an admin? false on the server and when unknown. */
const useAdmin = () => useSyncExternalStore(noop, () => rememberedUser()?.admin === true, () => false);

/** "Edit name": admins rename library songs; uploaders rename their own uploads (`direct`: the
 *  uploaded chart's page, seen only by its owner and admins). Players never rename library songs
 *  (Q13; the database refuses it too). */
export default function Rename({ slug, songId, title, artist, direct = false }: { slug: string; songId: string; title: string; artist: string | null; direct?: boolean }) {
  const router = useRouter();
  const offline = useOffline();
  const isAdmin = useAdmin();
  const [open, setOpen] = useState(false);
  const [t, setT] = useState(title);
  const [a, setA] = useState(artist ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [same, setSame] = useState<Same | null>(null);

  if (!direct && !isAdmin) return null;

  const close = () => {
    setOpen(false);
    setErr(null);
    setSame(null);
    setT(title);
    setA(artist ?? "");
  };

  const submit = async (anyway = false) => {
    setBusy(true);
    setErr(null);
    try {
      if (!anyway) {
        const hit = await findSameName(songId, t, a);
        if (hit) return setSame(hit);
      }
      setSame(null);
      const r = await renameSong({ songId, title: t, artist: a });
      if (!r.ok) return setErr(r.error);
      setOpen(false);
      // An uploaded chart's editor holds the chart text (with its {title:} line): reload it fresh.
      if (direct) window.location.reload();
      else if (r.slug !== slug) router.replace(`/songs/${r.slug}`);
      else router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const field = "bb-input h-12 w-full bg-bb-case-charcoal px-3 text-lg";

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center self-start text-lg text-bb-cue-gray underline">
        Edit name
      </button>
    );
  }

  return (
    <section className="border border-bb-rule-gray p-3" aria-label="Edit name">
      <h2 className="mb-2 text-xl font-bold">Rename song</h2>
      {offline ? (
        <>
          <OfflineNote />
          <button onClick={close} className="bb-btn bb-btn-secondary mt-3 h-12 w-full px-4 text-lg">
            Close
          </button>
        </>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="flex flex-col gap-1 text-base text-bb-cue-gray">
            Title
            <input value={t} onChange={(e) => setT(e.target.value)} maxLength={200} required className={field} />
          </label>
          <label className="flex flex-col gap-1 text-base text-bb-cue-gray">
            Artist
            <input value={a} onChange={(e) => setA(e.target.value)} maxLength={200} className={field} />
          </label>
          {err && <p className="bb-error border border-bb-stop-red p-3 text-lg">{err}</p>}
          {same ? (
            <div className="flex flex-col gap-2 border border-bb-rule-gray p-3" role="alert">
              <p className="text-lg text-bb-chart-white">
                “{same.title}”{same.artist ? ` by ${same.artist}` : ""} already exists.{" "}
                <Link href={`/songs/${same.slug}`} className="underline">
                  Open it
                </Link>
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setSame(null)} className="bb-btn bb-btn-primary h-12 flex-1 px-4 text-lg">
                  Cancel
                </button>
                <button type="button" disabled={busy} onClick={() => void submit(true)} className="bb-btn bb-btn-secondary h-12 flex-1 px-4 text-lg">
                  Save anyway
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button type="button" onClick={close} className="bb-btn bb-btn-secondary h-12 flex-1 px-4 text-lg">
                Cancel
              </button>
              <button disabled={busy} className="bb-btn bb-btn-primary h-12 flex-1 px-4 text-lg">
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          )}
        </form>
      )}
    </section>
  );
}
