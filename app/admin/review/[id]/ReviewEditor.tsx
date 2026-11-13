"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { buildView, checkChart } from "@/lib/chart";
import { FLAG_REASONS, unclearNotes } from "@/lib/review/unclear";
import Chart from "@/app/songs/[slug]/Chart";
import { FONTS } from "@/app/songs/[slug]/hooks";
import { dismissFlags, publishReview, setHold } from "../actions";

export interface ReviewSong {
  id: string;
  slug: string;
  title: string;
  artist: string | null;
  status: string;
  unverified: boolean;
  review_hold: boolean;
  revision_id: string | null;
  chart_text: string | null;
  source: string | null;
  confidence: number | null;
  notes: string | null;
  import_file_id: string | null;
  flags: { reason: keyof typeof FLAG_REASONS; details: string | null; created_at: string; by: string | null }[];
  next_id: string | null;
}

const btn = "min-h-12 rounded-xl px-5 text-lg font-semibold disabled:opacity-40";

export default function ReviewEditor({ song }: { song: ReviewSong }) {
  const router = useRouter();
  const area = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(song.chart_text ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const check = useMemo(() => checkChart(text), [text]);
  const view = useMemo(() => (check.doc ? buildView(check.doc) : null), [check.doc]);
  const notes = useMemo(() => unclearNotes(text), [text]);
  const next = song.next_id ? `/admin/review/${song.next_id}` : "/admin/review";
  const formatOk = !check.error && check.longCues.length === 0;

  const jump = (start: number, end: number) => {
    const el = area.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(start, end);
    // Scroll the selected line into view (roughly: line height × line number).
    const line = text.slice(0, start).split("\n").length - 1;
    el.scrollTop = Math.max(0, line * 28 - el.clientHeight / 3);
  };

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, then: string | null, done: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setMsg({ ok: true, text: done });
      if (then) router.push(then);
      else router.refresh();
    });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/admin/review" className="inline-flex min-h-11 items-center text-lg text-accent">
          ← Queue
        </Link>
        <Link href={next} className="inline-flex min-h-11 items-center text-lg text-muted">
          Skip ›
        </Link>
      </div>
      <h1 className="text-3xl font-bold leading-tight">
        {song.title} <span className="text-muted">· {song.artist ?? "no artist"}</span>
      </h1>
      <p className="mb-4 text-lg text-muted">
        {song.status === "published" ? (song.unverified ? "Live, unverified" : "Live, verified") : "Not live yet"}
        {song.confidence != null && ` · reader confidence ${Number(song.confidence).toFixed(2)}`}
        {song.review_hold && " · on hold"}
        {song.notes && ` · “${song.notes}”`}
      </p>

      {song.flags.length > 0 && (
        <section className="mb-4 rounded-xl border border-red-500/60 bg-red-500/10 p-4" aria-label="Player flags">
          <h2 className="mb-2 text-xl font-semibold">Flagged by {song.flags.length} player{song.flags.length === 1 ? "" : "s"}</h2>
          <ul className="mb-3 flex flex-col gap-1 text-lg">
            {song.flags.map((f, i) => (
              <li key={i}>
                <b>{FLAG_REASONS[f.reason] ?? f.reason}</b>
                {f.details && <> · “{f.details}”</>}
                <span className="text-muted"> · {f.by ?? "a player"}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => dismissFlags(song.id), null, "Flags dismissed.")}
            className={`${btn} border border-line`}
          >
            Dismiss flags (chart is right)
          </button>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="lg:sticky lg:top-2 lg:self-start">
          {song.import_file_id ? (
            <>
              <iframe
                src={`/admin/import/pdf/${song.import_file_id}?inline=1`}
                title={`Original chart: ${song.title}`}
                className="hidden h-[88vh] w-full rounded-lg bg-white lg:block"
              />
              <a
                href={`/admin/import/pdf/${song.import_file_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center rounded-lg border border-line px-3 text-lg text-accent lg:hidden"
              >
                View original PDF
              </a>
            </>
          ) : (
            <p className="text-muted">No original PDF linked to this song.</p>
          )}
        </div>

        <div className="min-w-0">
          {notes.length > 0 ? (
            <section className="mb-3" aria-label="Unclear spots">
              <h2 className="mb-1 text-xl font-semibold">
                {notes.length} unclear spot{notes.length === 1 ? "" : "s"}{" "}
                <span className="text-base font-normal text-muted">· tap to find it, fix the bar, delete the note</span>
              </h2>
              <ul className="flex flex-col gap-1">
                {notes.map((n) => (
                  <li key={n.start}>
                    <button
                      type="button"
                      onClick={() => jump(n.start, n.end)}
                      className="w-full rounded-lg bg-amber-400/15 px-3 py-2 text-left text-base text-amber-100 active:bg-amber-400/30"
                    >
                      {n.where && <b>{n.where}: </b>}
                      {n.saw}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <p className="mb-3 rounded-lg bg-green-500/15 px-3 py-2 text-lg text-green-100">No unclear notes left.</p>
          )}

          <label htmlFor="chart" className="sr-only">Chart text</label>
          <textarea
            id="chart"
            ref={area}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            rows={18}
            className="w-full rounded-lg border border-line bg-background p-3 font-mono text-lg leading-7"
          />
          {check.error && <p className="mt-1 text-lg text-red-300">Format error: {check.error}</p>}
          {check.longCues.length > 0 && <p className="mt-1 text-lg text-red-300">Cue over 6 words (no lyrics): “{check.longCues[0]}”</p>}

          <div className="my-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || !formatOk || notes.length > 0}
              title={notes.length ? "Fix or delete every unclear note first" : undefined}
              onClick={() => run(() => publishReview(song.id, text, true, song.revision_id), next, "Published as verified.")}
              className={`${btn} bg-accent text-black`}
            >
              Publish (verified)
            </button>
            <button
              type="button"
              disabled={pending || !formatOk}
              onClick={() => run(() => publishReview(song.id, text, false, song.revision_id), next, "Published as unverified.")}
              className={`${btn} border border-line`}
            >
              Publish as unverified
            </button>
            {song.status === "needs_review" && (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => setHold(song.id, !song.review_hold), song.review_hold ? null : next, song.review_hold ? "Back in the queue." : "On hold.")}
                className={`${btn} border border-line`}
              >
                {song.review_hold ? "Take off hold" : "Hold (can't fix now)"}
              </button>
            )}
          </div>
          <p role="status" aria-live="polite" className={`mb-4 text-lg ${msg?.ok ? "text-muted" : "text-red-300"}`}>
            {msg?.text}
          </p>

          <h2 className="mb-2 text-xl font-semibold">Preview</h2>
          {view ? (
            <Chart view={view} chords={false} fontFamily={FONTS.atkinson.css} fontWeight={FONTS.atkinson.weight} style={{ fontSize: "1.6rem" }} />
          ) : (
            <p className="text-muted">Fix the format error to see the preview.</p>
          )}
        </div>
      </div>
    </>
  );
}
