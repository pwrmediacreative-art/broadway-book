"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bulkUnverified } from "./actions";

const input = "min-h-11 w-24 rounded-lg border border-line bg-background px-3 text-lg";

/** Publish every clean-enough chart as unverified: count first, then confirm. */
export default function BulkPublish() {
  const router = useRouter();
  const [maxUnclear, setMaxUnclear] = useState("3");
  const [minConf, setMinConf] = useState("0.75");
  const [count, setCount] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const limits = () => [Number.parseInt(maxUnclear, 10), Number(minConf)] as const;

  const preview = () =>
    start(async () => {
      const [u, c] = limits();
      const r = await bulkUnverified(u, c, true);
      if (!r.ok) return setMsg(r.error);
      setMsg(null);
      setCount(r.n);
    });
  const publish = () =>
    start(async () => {
      const [u, c] = limits();
      if (!window.confirm(`Publish ${count} charts as unverified? Players will see them with an “Unverified” badge.`)) return;
      const r = await bulkUnverified(u, c, false);
      if (!r.ok) return setMsg(r.error);
      setCount(null);
      setMsg(`Published ${r.n} charts as unverified.`);
      router.refresh();
    });

  return (
    <details className="mb-4 rounded-xl border border-line bg-panel">
      <summary className="flex min-h-11 cursor-pointer items-center px-4 py-3 text-xl font-semibold">Publish clean charts as unverified</summary>
      <div className="border-t border-line px-4 py-3">
        <p className="mb-3 text-muted">
          Players see these with an “Unverified” badge and can flag or fix them. Held songs are skipped.
        </p>
        <div className="mb-3 flex flex-wrap items-end gap-4">
          <label className="flex flex-col text-base">
            At most this many unclear spots
            <input type="number" min={0} max={50} value={maxUnclear} onChange={(e) => (setMaxUnclear(e.target.value), setCount(null))} className={input} />
          </label>
          <label className="flex flex-col text-base">
            Confidence at least
            <input type="number" min={0} max={1} step={0.05} value={minConf} onChange={(e) => (setMinConf(e.target.value), setCount(null))} className={input} />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={preview} disabled={pending} className="min-h-11 rounded-xl border border-line px-5 text-lg font-semibold disabled:opacity-60">
            {pending && count === null ? "Counting…" : "Count matching charts"}
          </button>
          {count !== null && count > 0 && (
            <button type="button" onClick={publish} disabled={pending} className="min-h-11 rounded-xl bg-accent px-5 text-lg font-semibold text-black disabled:opacity-60">
              {pending ? "Publishing…" : `Publish ${count} as unverified`}
            </button>
          )}
        </div>
        <p role="status" aria-live="polite" className="mt-2 text-lg text-muted">
          {count === 0 ? "No charts match." : null}
          {msg}
        </p>
      </div>
    </details>
  );
}
