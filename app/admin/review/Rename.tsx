"use client";

// Admin lists (/admin/import, /admin/review): an inline "Rename" for one song. Title + artist,
// a same-name check before saving, and the error inline. No browser dialogs.
import { useId, useState, useTransition, type ChangeEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { OFFLINE_MSG, useOffline } from "@/lib/offline/status";
import { findSameName } from "@/lib/songs/dupName";
import { renameSong } from "@/app/songs/[slug]/rename-actions";

type Same = { slug: string; title: string; artist: string | null };

interface Props {
  songId: string;
  title: string | null;
  artist: string | null;
  /** The row as it shows when not renaming. */
  children: ReactNode;
  /** Other buttons for the row (View PDF, Back to review…), shown beside Rename. */
  actions?: ReactNode;
  /** "side": buttons to the right of the row. "below": buttons under it (rows that are links). */
  layout?: "side" | "below";
  /** Extra classes for the "below" button bar and the open form (padding to match the row). */
  pad?: string;
}

export function Renamable({ songId, title, artist, children, actions, layout = "side", pad = "" }: Props) {
  const [open, setOpen] = useState(false);
  const button = (
    <button type="button" onClick={() => setOpen(true)} aria-label={`Rename ${title ?? "song"}`} className="bb-btn bb-btn-secondary px-4">
      Rename
    </button>
  );
  if (open) return <RenameForm songId={songId} title={title} artist={artist} onDone={() => setOpen(false)} className={layout === "below" ? `${pad} pt-3` : pad} />;
  if (layout === "below")
    return (
      <>
        {children}
        <div className={`flex flex-wrap items-center gap-2 ${pad}`}>
          {button}
          {actions}
        </div>
      </>
    );
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">{children}</div>
      <div className="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row">
        {actions}
        {button}
      </div>
    </div>
  );
}

export function RenameForm({
  songId,
  title,
  artist,
  onDone,
  className = "",
}: {
  songId: string;
  title: string | null;
  artist: string | null;
  onDone: () => void;
  className?: string;
}) {
  const id = useId();
  const router = useRouter();
  const offline = useOffline();
  const [t, setT] = useState(title ?? "");
  const [a, setA] = useState(artist ?? "");
  const [error, setError] = useState<string | null>(null);
  const [same, setSame] = useState<Same | null>(null);
  const [pending, start] = useTransition();

  const save = (anyway: boolean) =>
    start(async () => {
      setError(null);
      if (!t.trim()) return setError("The title can't be empty.");
      if (!anyway) {
        const hit = await findSameName(songId, t, a);
        if (hit) return setSame(hit);
      }
      const r = await renameSong({ songId, title: t, artist: a });
      if (!r.ok) {
        setSame(null);
        return setError(r.error);
      }
      onDone();
      router.refresh();
    });

  // Editing either field after a warning means the warning no longer applies.
  const edit = (set: (v: string) => void) => (e: ChangeEvent<HTMLInputElement>) => {
    set(e.target.value);
    setSame(null);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(false);
      }}
      className={`grid gap-2 sm:grid-cols-2 ${className}`}
      aria-label={`Rename ${title ?? "song"}`}
    >
      <label htmlFor={`${id}-t`} className="flex flex-col gap-1 text-bb-label text-bb-cue-gray">
        Title
        <input id={`${id}-t`} value={t} onChange={edit(setT)} required maxLength={200} autoFocus className="bb-input w-full" />
      </label>
      <label htmlFor={`${id}-a`} className="flex flex-col gap-1 text-bb-label text-bb-cue-gray">
        Artist
        <input id={`${id}-a`} value={a} onChange={edit(setA)} maxLength={200} className="bb-input w-full" />
      </label>

      {same ? (
        <div role="alert" className="flex flex-col gap-2 sm:col-span-2">
          <p className="text-lg">
            <b>Same name:</b> “{same.title}”{same.artist ? ` by ${same.artist}` : ""} already exists.{" "}
            <a href={`/songs/${same.slug}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-bb-downbeat-amber underline">
              Open it
            </a>
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => save(true)} disabled={pending || offline} className="bb-btn bb-btn-secondary px-5">
              {pending ? "Saving…" : "Save anyway"}
            </button>
            <button type="button" onClick={onDone} disabled={pending} className="bb-btn bb-btn-secondary px-5">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button type="submit" disabled={pending || offline} className="bb-btn bb-btn-secondary px-5">
            {pending ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={onDone} disabled={pending} className="bb-btn bb-btn-secondary px-5">
            Cancel
          </button>
        </div>
      )}

      {(offline || error) && (
        <p role="status" className={`sm:col-span-2 ${offline ? "text-bb-cue-gray" : "bb-error"}`}>
          {offline ? OFFLINE_MSG : error}
        </p>
      )}
    </form>
  );
}
