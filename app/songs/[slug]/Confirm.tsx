"use client";

// "Played it, it's right" on Unverified song pages (never in stage or setlist play mode).
// One tap per player per exact chart; tap again to take it back. Never changes Verified.

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { browserClient } from "@/lib/supabase/browser";
import { readConfirmState, type ConfirmState } from "@/lib/confirm";
import { isNetworkError, OFFLINE_MSG, reportOffline, useOffline } from "@/lib/offline/status";

/** Live count + whether this player confirmed (not cached with the page). */
export function useConfirm(songId: string, enabled: boolean) {
  const [state, setState] = useState<ConfirmState | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const offline = useOffline();
  useEffect(() => {
    if (!enabled || offline) return;
    let alive = true;
    const sb = browserClient();
    sb.auth.getSession().then(({ data }) => {
      if (alive) setSignedIn(!!data.session);
    });
    sb.rpc("chart_confirm_state", { p_song_id: songId }).then(({ data }) => {
      if (alive) setState(readConfirmState(data));
    });
    return () => {
      alive = false;
    };
  }, [songId, enabled, offline]);
  return { state, setState, signedIn };
}

type Confirm = ReturnType<typeof useConfirm>;

export function ConfirmButton({ slug, songId, c }: { slug: string; songId: string; c: Confirm }) {
  const offline = useOffline();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const count = c.state?.count ?? null;
  const mine = c.state?.mine ?? false;

  const toggle = () =>
    start(async () => {
      const { data, error } = await browserClient().rpc("chart_confirm_toggle", { p_song_id: songId });
      if (error) {
        if (isNetworkError(error)) {
          reportOffline();
          return setErr(OFFLINE_MSG);
        }
        return setErr(error.message);
      }
      setErr(null);
      const next = readConfirmState(data);
      if (next) c.setState(next);
    });

  const label = (
    <>
      <span className="flex items-center justify-between gap-3 text-xl font-bold">
        <span>{mine ? "✓ Played it, it's right" : "Played it, it's right"}</span>
        {count !== null && (
          <span className="font-bb-data tabular-nums" aria-label={`${count} confirmed`} data-confirm-count>
            {count}
          </span>
        )}
      </span>
      <span className="text-base text-bb-cue-gray">
        {mine ? "You confirmed this chart. Tap again to take it back." : "Tap if this chart matched what you played."}
      </span>
    </>
  );
  const box = "flex min-h-16 w-full flex-col justify-center rounded-bb-control border px-5 py-2 text-left";

  return (
    <section className="mt-10" aria-label="Confirm this chart" data-confirm>
      {offline ? (
        <>
          <div aria-disabled className={`${box} border-bb-rule-gray`}>
            {label}
          </div>
          <p className="mt-2 text-base text-bb-cue-gray">{OFFLINE_MSG}</p>
        </>
      ) : c.signedIn === false ? (
        <Link href={`/login?next=${encodeURIComponent(`/songs/${slug}`)}`} className={`${box} border-bb-rule-gray active:bg-bb-case-charcoal`}>
          {label}
        </Link>
      ) : (
        <button
          type="button"
          aria-pressed={mine}
          disabled={pending || c.signedIn === null}
          onClick={toggle}
          className={`${box} ${mine ? "bb-on" : "border-bb-rule-gray"} active:bg-bb-case-charcoal`}
        >
          {label}
        </button>
      )}
      {err && <p className="bb-error mt-2 text-lg">{err}</p>}
    </section>
  );
}
