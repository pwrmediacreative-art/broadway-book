"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { OFFLINE_MSG, useOffline } from "@/lib/offline/status";
import { revertAuto } from "../actions";

/** One tap: an auto-approved chart leaves the public site and goes back to needs_review. */
export function SendBack({ songId, title }: { songId: string; title: string }) {
  const router = useRouter();
  const offline = useOffline();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const tap = () =>
    start(async () => {
      setError(null);
      const r = await revertAuto(songId);
      if (!r.ok) return setError(r.error);
      router.refresh();
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={tap}
        disabled={pending || offline}
        aria-label={`Back to review: ${title}`}
        className="bb-btn bb-btn-secondary px-4 text-lg"
      >
        {pending ? "Sending back…" : "Back to review"}
      </button>
      {(offline || error) && (
        <span role="status" className={offline ? "text-bb-cue-gray" : "bb-error"}>
          {offline ? OFFLINE_MSG : error}
        </span>
      )}
    </div>
  );
}
