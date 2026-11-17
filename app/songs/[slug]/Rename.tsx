"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { OfflineNote } from "@/app/OfflineRoot";
import { useOffline } from "@/lib/offline/status";
import { rememberedUser, type Me } from "@/lib/offline/user";
import { findSameName } from "@/lib/songs/dupName";
import { proposeRename, renameSong } from "./rename-actions";

type Same = { slug: string; title: string; artist: string | null };

/** "Edit name": admins rename at once; other signed-in players suggest a name for the community vote.
 *  `direct`: the viewer may rename at once (an uploaded chart's page, seen only by its owner and admins). */
export default function Rename({ slug, songId, title, artist, direct = false }: { slug: string; songId: string; title: string; artist: string | null; direct?: boolean }) {
  const router = useRouter();
  const offline = useOffline();
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const [t, setT] = useState(title);
  const [a, setA] = useState(artist ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [same, setSame] = useState<Same | null>(null);
  const [sent, setSent] = useState(false);

  const admin = direct || !!me?.admin;
  const close = () => {
    setOpen(false);
    setErr(null);
    setSame(null);
    setT(title);
    setA(artist ?? "");
    setNote("");
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
      if (admin) {
        const r = await renameSong({ songId, title: t, artist: a });
        if (!r.ok) return setErr(r.error);
        setOpen(false);
        // An uploaded chart's editor holds the chart text (with its {title:} line): reload it fresh.
        if (direct) window.location.reload();
        else if (r.slug !== slug) router.replace(`/songs/${r.slug}`);
        else router.refresh();
      } else {
        const r = await proposeRename({ songId, title: t, artist: a, note });
        if (!r.ok) return setErr(r.error);
        setOpen(false);
        setSent(true);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const field = "bb-input h-12 w-full bg-bb-case-charcoal px-3 text-lg";

  if (!open) {
    return (
      <div className="flex flex-col gap-1">
        <button
          onClick={() => {
            setMe(rememberedUser()); // who is signed in on this phone (read when opened)
            setOpen(true);
          }}
          className="inline-flex min-h-11 items-center self-start text-lg text-bb-cue-gray underline">
          Edit name
        </button>
        {sent && (
          <p className="text-base text-bb-chart-white" aria-live="polite">
            ✓ Name suggested. It goes live after other players approve it.{" "}
            <Link href="/community" className="underline">
              See suggestions
            </Link>
          </p>
        )}
      </div>
    );
  }

  return (
    <section className="border border-bb-rule-gray p-3" aria-label="Edit name">
      <h2 className="mb-2 text-xl font-bold">{admin ? "Rename song" : "Suggest a new name"}</h2>
      {offline ? (
        <OfflineNote />
      ) : !me ? (
        <p className="text-lg text-bb-cue-gray">
          <Link href={`/login?next=${encodeURIComponent(`/songs/${slug}`)}`} className="text-bb-chart-white underline">
            Sign in
          </Link>{" "}
          to suggest a new name.
        </p>
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
          {!admin && (
            <label className="flex flex-col gap-1 text-base text-bb-cue-gray">
              Why (optional)
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={field} />
            </label>
          )}
          {!admin && <p className="text-base text-bb-cue-gray">Other players vote on it. It goes live after 3 approvals.</p>}
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
                  {admin ? "Save anyway" : "Suggest anyway"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button type="button" onClick={close} className="bb-btn bb-btn-secondary h-12 flex-1 px-4 text-lg">
                Cancel
              </button>
              <button disabled={busy} className="bb-btn bb-btn-primary h-12 flex-1 px-4 text-lg">
                {busy ? "Saving…" : admin ? "Save" : "Suggest"}
              </button>
            </div>
          )}
        </form>
      )}
      {(offline || !me) && (
        <button onClick={close} className="bb-btn bb-btn-secondary mt-3 h-12 w-full px-4 text-lg">
          Close
        </button>
      )}
    </section>
  );
}
