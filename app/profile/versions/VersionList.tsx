"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { isStale, loadMyVersions, useMyVersions } from "@/lib/personal/versions";
import { deletePersonal } from "@/app/community/actions";
import { when } from "@/app/community/ui";

export default function VersionList() {
  const { ready, userId, list } = useMyVersions();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  if (!ready) return <p className="text-lg text-muted">Loading…</p>;
  if (!userId)
    return (
      <p className="text-lg">
        <Link href="/login?next=/profile/versions" className="text-accent">
          Sign in
        </Link>{" "}
        to see your versions.
      </p>
    );
  if (!list.length)
    return (
      <p className="rounded-xl border border-line bg-panel p-4 text-lg text-muted">
        None yet. Open a song, tap “Suggest a change”, then “Just for me”.
      </p>
    );

  return (
    <>
      {err && <p className="mb-3 text-lg text-red-300">{err}</p>}
      <ul className="flex flex-col gap-3">
        {list.map((v) => (
          <li key={v.song_id} className="rounded-xl border border-line bg-panel p-4">
            <p className="text-xl font-semibold">{v.title}</p>
            <p className="text-muted">
              {v.artist ? `${v.artist} · ` : ""}saved {when(v.updated_at)}
            </p>
            {isStale(v) && <p className="mt-1 text-amber-200">The public chart changed since your version.</p>}
            {v.note && <p className="mt-1 text-muted">“{v.note}”</p>}
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Link href={`/songs/${v.slug}`} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-accent text-lg font-bold text-black">
                Open
              </Link>
              <button
                disabled={pending}
                onClick={() => {
                  if (!window.confirm(`Reset “${v.title}” to the public version? This deletes your version. It can't be undone.`)) return;
                  start(async () => {
                    const r = await deletePersonal(v.song_id);
                    if (!r.ok) return setErr(r.error);
                    await loadMyVersions();
                  });
                }}
                className="min-h-12 rounded-xl border border-line text-lg disabled:opacity-40"
              >
                Reset to public
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
