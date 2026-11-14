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
          className={`bb-chip ${pick.usingMine ? "" : "bb-chip-muted"}`}
        >
          {pick.usingMine ? "Your version" : "Public version"}
        </span>
        <button
          onClick={() => pick.setShowPublic(pick.usingMine)}
          className="bb-btn bb-btn-secondary min-h-11 px-4 text-lg font-normal"
        >
          {pick.usingMine ? "View public version" : "View your version"}
        </button>
      </div>

      {pick.usingMine && pick.stale && (
        <div className="bb-notice mt-3 p-4 text-lg">
          <p>
            <b>The public chart changed</b> since your version.
          </p>
          <button className="min-h-11 underline" onClick={() => setShowDiff((v) => !v)}>
            {showDiff ? "Hide what changed" : "Show what changed"}
          </button>
          {showDiff &&
            (publicDiff ? (
              <div className="mt-2 text-bb-chart-white">
                <p className="mb-1 text-base text-bb-cue-gray">
                  Public chart: <DiffSummary diff={publicDiff} />
                </p>
                <BarDiff diff={publicDiff} />
              </div>
            ) : (
              <p className="text-base text-bb-cue-gray">{baseText === null && basedOn ? "Loading…" : "The older public chart isn't available to compare."}</p>
            ))}
          {offline ? (
            <OfflineNote className="mt-3" />
          ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <button
              disabled={pending || !mine.current_revision_id}
              onClick={() => act(() => keepPersonal(songId, mine.current_revision_id!))}
              className="bb-btn bb-btn-secondary min-h-12 px-4 font-bold"
            >
              Keep mine
            </button>
            <button
              disabled={pending}
              onClick={() => act(() => deletePersonal(songId), RESET_CONFIRM)}
              className="bb-btn bb-btn-secondary min-h-12 px-4 font-normal"
            >
              Switch to public
            </button>
            <Link href={`/songs/${slug}/edit`} className="bb-btn bb-btn-secondary min-h-12 px-4 font-normal">
              Edit mine
            </Link>
          </div>
          )}
        </div>
      )}
      {err && <p className="bb-error mt-2 text-lg">{err}</p>}
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
      className="group ml-2 inline-flex min-h-11 items-center align-middle"
    >
      <span className="bb-chip group-active:bg-bb-case-charcoal">
        {count} open suggestion{count === 1 ? "" : "s"}
      </span>
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
      <section id="suggest" className="mt-10 flex scroll-mt-20 flex-col gap-3" aria-label="Change this chart">
        <div aria-disabled className="flex min-h-16 flex-col justify-center rounded-bb-control border border-bb-rule-gray px-5 py-2">
          <span className="text-xl font-bold">✎ Suggest a change</span>
          <span className="text-base text-bb-cue-gray">Fix it for everyone, or keep a version just for you.</span>
        </div>
        <OfflineNote />
      </section>
    );
  }
  return (
    <section id="suggest" className="mt-10 flex scroll-mt-20 flex-col gap-3" aria-label="Change this chart">
      <Link href={`/songs/${slug}/edit`} className="flex min-h-16 flex-col justify-center rounded-bb-control border border-bb-rule-gray px-5 py-2 active:bg-bb-case-charcoal">
        <span className="text-xl font-bold text-bb-chart-white">✎ Suggest a change</span>
        <span className="text-base text-bb-cue-gray">Fix it for everyone, or keep a version just for you.</span>
      </Link>
      {pick.mine && (
        <div className="grid grid-cols-2 gap-3">
          <Link
            href={`/songs/${slug}/edit?intent=suggest`}
            className="bb-btn bb-btn-secondary min-h-12 px-3 text-center text-lg font-normal"
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
            className="bb-btn bb-btn-secondary min-h-12 px-3 text-lg font-normal"
          >
            Reset to public version
          </button>
        </div>
      )}
      {err && <p className="bb-error text-lg">{err}</p>}
      <FlagButton slug={slug} songId={songId} />
      <Link href={`/songs/${slug}/history`} className="inline-flex min-h-11 items-center text-lg text-bb-cue-gray underline">
        Chart history
      </Link>
    </section>
  );
}
