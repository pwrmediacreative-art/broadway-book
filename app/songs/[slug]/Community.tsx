"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { diffCharts } from "@/lib/chart";
import { browserClient } from "@/lib/supabase/browser";
import { loadMyVersions, type usePickedChart } from "@/lib/personal/versions";
import { deletePersonal, keepPersonal } from "@/app/community/actions";
import BarDiff, { DiffSummary } from "@/app/community/BarDiff";
import FlagButton from "./FlagButton";
import { OfflineNote } from "@/app/OfflineRoot";
import { useOffline } from "@/lib/offline/status";

type Pick = ReturnType<typeof usePickedChart>;

const RESET_CONFIRM = "Reset to the public version? This deletes your version of this song. It can't be undone.";

/** "Your version" label, one-tap public toggle, and the "public chart changed" choices. */
export function PersonalBar({ slug, songId, pick, publicText }: { slug: string; songId: string; pick: Pick; publicText: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [baseText, setBaseText] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const mine = pick.mine;
  const basedOn = mine?.based_on_revision_id ?? null;
  const offline = useOffline();

  useEffect(() => {
    if (!showDiff || !basedOn || baseText !== null) return;
    browserClient()
      .from("revisions")
      .select("chart_text")
      .eq("id", basedOn)
      .maybeSingle()
      .then(({ data }) => setBaseText(data?.chart_text ?? ""));
  }, [showDiff, basedOn, baseText]);

  const publicDiff = useMemo(() => {
    if (!baseText) return null;
    try {
      return diffCharts(baseText, publicText);
    } catch {
      return null;
    }
  }, [baseText, publicText]);

  if (!mine) return null;

  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    start(async () => {
      const r = await fn();
      if (!r.ok) return setErr(r.error);
      setErr(null);
      pick.setShowPublic(false);
      await loadMyVersions();
    });
  };

  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-3 py-1 text-sm font-bold uppercase tracking-wide ${
            pick.usingMine ? "bg-violet-400/25 text-violet-100" : "bg-panel text-muted"
          }`}
        >
          {pick.usingMine ? "Your version" : "Public version"}
        </span>
        <button
          onClick={() => pick.setShowPublic(pick.usingMine)}
          className="min-h-11 rounded-xl border border-line bg-panel px-4 text-lg active:bg-line"
        >
          {pick.usingMine ? "View public version" : "View your version"}
        </button>
      </div>

      {pick.usingMine && pick.stale && (
        <div className="mt-3 rounded-xl border border-amber-400/60 bg-amber-400/10 p-4 text-lg text-amber-100">
          <p className="font-semibold">The public chart changed since your version.</p>
          <button className="min-h-11 underline" onClick={() => setShowDiff((v) => !v)}>
            {showDiff ? "Hide what changed" : "Show what changed"}
          </button>
          {showDiff &&
            (publicDiff ? (
              <div className="mt-2 text-foreground">
                <p className="mb-1 text-base text-muted">
                  Public chart: <DiffSummary diff={publicDiff} />
                </p>
                <BarDiff diff={publicDiff} />
              </div>
            ) : (
              <p className="text-base text-muted">{baseText === null && basedOn ? "Loading…" : "The older public chart isn't available to compare."}</p>
            ))}
          {offline ? (
            <OfflineNote className="mt-3" />
          ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <button
              disabled={pending || !mine.current_revision_id}
              onClick={() => act(() => keepPersonal(songId, mine.current_revision_id!))}
              className="min-h-12 rounded-xl bg-accent px-4 font-bold text-black disabled:opacity-40"
            >
              Keep mine
            </button>
            <button
              disabled={pending}
              onClick={() => act(() => deletePersonal(songId), RESET_CONFIRM)}
              className="min-h-12 rounded-xl border border-line bg-panel px-4 disabled:opacity-40"
            >
              Switch to public
            </button>
            <Link href={`/songs/${slug}/edit`} className="inline-flex min-h-12 items-center justify-center rounded-xl border border-line bg-panel px-4">
              Edit mine
            </Link>
          </div>
          )}
        </div>
      )}
      {err && <p className="mt-2 text-lg text-red-300">{err}</p>}
    </div>
  );
}

/** Open-suggestion count for one song (live, not cached with the page). */
export function useOpenCount(songId: string) {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    browserClient()
      .from("proposals")
      .select("id", { count: "exact", head: true })
      .eq("song_id", songId)
      .eq("status", "open")
      .then(({ count }) => {
        if (alive) setN(count ?? 0);
      });
    return () => {
      alive = false;
    };
  }, [songId]);
  return n;
}

export function OpenBadge({ slug, count }: { slug: string; count: number | null }) {
  if (!count) return null;
  return (
    <Link
      href={`/community?song=${encodeURIComponent(slug)}`}
      className="ml-2 inline-flex min-h-8 items-center rounded-full bg-sky-400/20 px-2.5 text-sm font-semibold text-sky-100 active:bg-sky-400/40"
    >
      {count} open suggestion{count === 1 ? "" : "s"}
    </Link>
  );
}

/** Below the chart: change it (just for me or for everyone), personal-version actions, history. */
export function SongActions({ slug, songId, pick }: { slug: string; songId: string; pick: Pick }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const offline = useOffline();
  // Offline: suggesting, voting, personal edits and flagging all need the server.
  if (offline) {
    return (
      <section className="mt-10 flex flex-col gap-3" aria-label="Change this chart">
        <div aria-disabled className="flex min-h-16 flex-col justify-center rounded-2xl border-2 border-line px-5 py-2 opacity-50">
          <span className="text-xl font-bold">✎ Suggest a change</span>
          <span className="text-base text-muted">Fix it for everyone, or keep a version just for you.</span>
        </div>
        <OfflineNote />
      </section>
    );
  }
  return (
    <section className="mt-10 flex flex-col gap-3" aria-label="Change this chart">
      <Link href={`/songs/${slug}/edit`} className="flex min-h-16 flex-col justify-center rounded-2xl border-2 border-accent px-5 py-2 active:bg-accent/20">
        <span className="text-xl font-bold text-accent">✎ Suggest a change</span>
        <span className="text-base text-muted">Fix it for everyone, or keep a version just for you.</span>
      </Link>
      {pick.mine && (
        <div className="grid grid-cols-2 gap-3">
          <Link
            href={`/songs/${slug}/edit?intent=suggest`}
            className="inline-flex min-h-12 items-center justify-center rounded-xl border border-line bg-panel px-3 text-center text-lg"
          >
            Suggest this for everyone
          </Link>
          <button
            disabled={pending}
            onClick={() => {
              if (!window.confirm(RESET_CONFIRM)) return;
              start(async () => {
                const r = await deletePersonal(songId);
                if (!r.ok) return setErr(r.error);
                pick.setShowPublic(false);
                await loadMyVersions();
              });
            }}
            className="min-h-12 rounded-xl border border-line bg-panel px-3 text-lg disabled:opacity-40"
          >
            Reset to public version
          </button>
        </div>
      )}
      {err && <p className="text-lg text-red-300">{err}</p>}
      <FlagButton slug={slug} songId={songId} />
      <Link href={`/songs/${slug}/history`} className="inline-flex min-h-11 items-center text-lg text-muted underline">
        Chart history
      </Link>
    </section>
  );
}
