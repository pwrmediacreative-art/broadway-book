"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { bulkVerify } from "../actions";

export interface Card {
  id: string;
  slug: string;
  title: string;
  artist: string | null;
  unverified_since: string | null;
  revision_id: string;
  chart_text: string;
  unclear: number;
  file_id: string | null;
  claimed: boolean;
}

/**
 * Each card shows the whole chart text and a link to its PDF. The tick box unlocks only after
 * that PDF link has been tapped, so nothing is verified blind. One tap verifies the ticked charts
 * (the database checks each is still the revision shown here and logs who verified it).
 */
export default function BulkVerify({ cards }: { cards: Card[] }) {
  const router = useRouter();
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const verify = () =>
    start(async () => {
      const items = cards.filter((c) => picked.has(c.id)).map((c) => ({ id: c.id, revision_id: c.revision_id }));
      const r = await bulkVerify(items);
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      const skipped = r.skipped.map((s) => `${cards.find((c) => c.id === s.id)?.title ?? "A chart"} (${s.why})`);
      setMsg({
        ok: skipped.length === 0,
        text: `Verified ${r.verified} chart${r.verified === 1 ? "" : "s"}.${skipped.length ? ` Skipped: ${skipped.join("; ")}.` : ""}`,
      });
      setPicked(new Set());
      router.refresh();
    });

  return (
    <>
      <ul className="flex flex-col gap-4">
        {cards.map((c) => {
          const why = c.claimed
            ? "Someone is reviewing this chart right now."
            : c.unclear > 0
              ? `Has ${c.unclear} unclear note${c.unclear === 1 ? "" : "s"}: open it in review.`
              : !c.file_id
                ? "No PDF on file: open it in review."
                : !opened.has(c.id)
                  ? "Open the PDF first."
                  : null;
          const on = picked.has(c.id);
          return (
            <li key={c.id} className={`rounded-xl border bg-bb-case-charcoal p-3 ${on ? "border-green-400" : "border-bb-rule-gray"}`} data-bulk-card>
              <h2 className="text-xl font-bold leading-tight">
                {c.title} <span className="font-normal text-bb-cue-gray">· {c.artist ?? "no artist"}</span>
              </h2>
              <div className="my-2 flex flex-wrap gap-2">
                {c.file_id && (
                  <a
                    href={`/admin/import/pdf/${c.file_id}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setOpened((o) => new Set(o).add(c.id))}
                    className="inline-flex min-h-12 items-center rounded-lg bg-bb-downbeat-amber px-4 text-lg font-bold text-bb-stage-black active:opacity-80"
                  >
                    Open PDF ↗
                  </a>
                )}
                <Link href={`/admin/review/${c.id}?f=unverified`} className="inline-flex min-h-12 items-center rounded-lg border border-bb-rule-gray px-4 text-lg">
                  Open in review
                </Link>
              </div>
              <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-lg border border-bb-rule-gray bg-bb-house-black p-3 font-mono text-base leading-relaxed">{c.chart_text}</pre>
              <label className={`mt-2 flex min-h-12 items-center gap-3 text-lg ${why ? "text-bb-cue-gray" : ""}`}>
                <input type="checkbox" className="size-7 shrink-0" checked={on} disabled={!!why || pending} onChange={() => toggle(c.id)} />
                {why ?? "This chart matches the original"}
              </label>
            </li>
          );
        })}
      </ul>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-bb-rule-gray bg-bb-house-black/95 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto flex max-w-2xl flex-col gap-1">
          {msg && (
            <p role="status" aria-live="polite" className={`text-base ${msg.ok ? "text-bb-cue-gray" : "text-amber-200"}`}>
              {msg.text}
            </p>
          )}
          <button
            type="button"
            disabled={pending || picked.size === 0}
            onClick={verify}
            className="min-h-14 w-full rounded-xl bg-green-500 text-xl font-bold text-bb-stage-black disabled:opacity-40"
          >
            {pending ? "Verifying…" : `✓ Verify ${picked.size} selected`}
          </button>
        </div>
      </div>
    </>
  );
}
