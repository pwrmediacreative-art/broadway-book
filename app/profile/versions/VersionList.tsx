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

  if (!ready) return <p className="text-lg text-bb-cue-gray">Loading…</p>;
  if (!userId)
    return (
      <p className="text-lg">
        <Link href="/login?next=/profile/versions" className="text-bb-chart-white underline underline-offset-4">
          Sign in
        </Link>{" "}
        to see your versions.
      </p>
    );
  if (!list.length)
    return (
      <p className="bb-panel p-4 text-lg text-bb-cue-gray">
        None yet. Open a song, tap “Suggest a change”, then “Just for me”.
      </p>
    );

  return (
    <>
      {err && <p className="bb-error mb-3 text-lg">{err}</p>}
      <ul className="divide-y divide-bb-rule-gray border-y border-bb-rule-gray">
        {list.map((v) => (
          <li key={v.song_id} className="py-4">
            <p className="text-xl font-semibold">{v.title}</p>
            <p className="text-bb-cue-gray">
              {v.artist ? `${v.artist} · ` : ""}saved {when(v.updated_at)}
            </p>
            {isStale(v) && (
              <p className="bb-notice mt-2">
                <b>Out of date:</b> The public chart changed since your version.
              </p>
            )}
            {v.note && <p className="mt-1 text-bb-cue-gray">“{v.note}”</p>}
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Link href={`/songs/${v.slug}`} className="bb-btn bb-btn-secondary min-h-12 text-lg">
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
                className="bb-btn bb-btn-danger min-h-12 text-lg"
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
