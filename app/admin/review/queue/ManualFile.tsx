"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { songForFile } from "../actions";

/** A can't-read PDF with no song yet: make its song, then open it to type the chart. */
export default function ManualFile({ id, label, q }: { id: string; label: string; q: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-panel px-4 py-2">
      <span className="min-w-0 truncate text-lg">{label}</span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await songForFile(id);
            if (!r.ok) return setErr(r.error);
            router.push(`/admin/review/${r.id}?${q}`);
          })
        }
        className="min-h-11 rounded-lg border border-line px-3 text-lg disabled:opacity-40"
      >
        Type it in
      </button>
      {err && <span className="w-full text-red-300">{err}</span>}
    </li>
  );
}
