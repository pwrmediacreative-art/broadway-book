"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { revertSong } from "@/app/community/actions";

export default function RevertButton({ songId, revisionId, when }: { songId: string; revisionId: string; when: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="mt-2">
      <button
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Make the version from ${when} live again? This adds a new version; history is kept.`)) return;
          start(async () => {
            const r = await revertSong(songId, revisionId);
            if (!r.ok) return setErr(r.error);
            router.refresh();
          });
        }}
        className="min-h-12 rounded-xl border border-accent px-4 text-lg text-accent active:bg-accent/20 disabled:opacity-40"
      >
        {pending ? "Reverting…" : "Revert to this version"}
      </button>
      {err && <p className="mt-1 text-lg text-red-300">{err}</p>}
    </div>
  );
}
