"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { OFFLINE_MSG, useOffline } from "@/lib/offline/status";
import { autoApproveExisting, pullBackAuto, saveAutoSettings } from "./auto-actions";

/** What auto_approve_overview() returns. */
export interface AutoOverview {
  enabled: boolean;
  min_confidence: number; // whole percent; a score must be strictly over it
  would_publish: number; // drafts in review that pass the rule with the saved settings
  live: number; // auto-approved charts live now that nobody has verified
  batch_auto: number; // full-batch readings that went live by themselves (ever)
  needs_review: number;
}

const solid = "bb-btn bb-btn-primary px-5 text-lg";
const ghost = "bb-btn bb-btn-secondary px-5 text-lg";
const danger = "bb-btn bb-btn-danger px-5 text-lg";
const field = "bb-input w-28 px-3 text-lg tabular-nums";
const charts = (n: number) => `${n.toLocaleString()} chart${n === 1 ? "" : "s"}`;

/**
 * The switch, the cutoff, "apply to the drafts already read" and "pull back".
 * The database holds the rule; this only shows counts and asks before anything goes
 * live or comes down.
 */
export function AutoApprove({ o }: { o: AutoOverview }) {
  const router = useRouter();
  const offline = useOffline();
  const [cutoff, setCutoff] = useState(String(o.min_confidence));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = cutoff !== String(o.min_confidence);
  const busy = pending || offline;

  const done = (text: string) => {
    setMsg({ ok: true, text });
    router.refresh();
  };
  const bad = (text: string) => setMsg({ ok: false, text });

  const toggle = () =>
    start(async () => {
      // The switch saves at once, with the cutoff already saved (not an unsaved edit).
      const r = await saveAutoSettings(!o.enabled, o.min_confidence);
      if (!r.ok) return bad(r.error);
      done(o.enabled ? "Auto-approve is off. Charts already live stay live." : "Auto-approve is on for new readings.");
    });

  const saveNumbers = () =>
    start(async () => {
      const r = await saveAutoSettings(o.enabled, Number(cutoff));
      if (!r.ok) return bad(r.error);
      done("Saved. Charts already live are not changed.");
    });

  const publishExisting = () =>
    start(async () => {
      const count = await autoApproveExisting(true);
      if (!count.ok) return bad(count.error);
      if (count.n === 0) return done("No charts in review pass these settings.");
      if (!window.confirm(`Publish ${charts(count.n)} as unverified? Players will see them with an “Unverified” badge. Nobody has checked them.`)) return;
      const r = await autoApproveExisting(false);
      if (!r.ok) return bad(r.error);
      done(`Published ${charts(r.n)} as unverified.`);
    });

  const pullBack = () =>
    start(async () => {
      const count = await pullBackAuto(true);
      if (!count.ok) return bad(count.error);
      if (count.n === 0) return done("No auto-approved charts are live.");
      if (!window.confirm(`Pull back ${charts(count.n)}? They leave the public site, search and saved copies until someone publishes them again.`)) return;
      const r = await pullBackAuto(false);
      if (!r.ok) return bad(r.error);
      done(`Pulled back ${charts(r.n)} to review.`);
    });

  return (
    <section className="bb-panel mb-6 p-4" aria-labelledby="auto-approve-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="auto-approve-title" className="text-2xl font-bold">
          Auto-approve
        </h2>
        <button
          type="button"
          role="switch"
          aria-checked={o.enabled}
          aria-label="Auto-approve AI charts"
          disabled={busy}
          onClick={toggle}
          className={`bb-btn px-5 text-lg ${o.enabled ? "bb-on" : "bb-btn-secondary"}`}
        >
          {o.enabled ? "On · tap to turn off" : "Off · tap to turn on"}
        </button>
      </div>
      <p className="mt-2 text-lg text-bb-cue-gray">
        When on, a new AI reading that passes these rules goes live by itself as Unverified. Everything else waits in the review
        queue. Skipped: charts with any unclear spot, charts that needed a second read, share a title and artist with another
        file, or are on hold, claimed or drafted, and any chart you sent back.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="flex flex-col text-base">
          Score must be over (%)
          <input type="number" inputMode="numeric" min={50} max={99} step={1} value={cutoff} onChange={(e) => setCutoff(e.target.value)} className={field} />
        </label>
        <button type="button" disabled={busy || !dirty} onClick={saveNumbers} className={ghost}>
          Save cutoff
        </button>
      </div>

      <dl className="mt-4 divide-y divide-bb-rule-gray border-y border-bb-rule-gray text-lg">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <dt>In review, would pass</dt>
          <dd className="tabular-nums">
            <b>{dirty ? "—" : o.would_publish.toLocaleString()}</b>
            <span className="text-bb-cue-gray"> of {o.needs_review.toLocaleString()}</span>
          </dd>
        </div>
        <div className="flex min-h-11 items-center justify-between gap-3">
          <dt>Auto-approved, live</dt>
          <dd className="tabular-nums font-bold">{o.live.toLocaleString()}</dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={busy || dirty || !o.enabled || o.would_publish === 0} onClick={publishExisting} className={solid}>
          Publish {dirty ? "" : `${o.would_publish.toLocaleString()} `}existing as unverified
        </button>
        <button type="button" disabled={busy || o.live === 0} onClick={pullBack} className={danger}>
          Pull back auto-approved ({o.live.toLocaleString()})
        </button>
        {o.live > 0 && (
          <Link href="/admin/review/queue?f=auto_approved" className="inline-flex min-h-11 items-center px-2 text-lg text-bb-downbeat-amber">
            See them in the queue ›
          </Link>
        )}
      </div>

      <p role="status" aria-live="polite" className={`mt-2 min-h-7 text-lg ${msg && !msg.ok ? "bb-error" : "text-bb-cue-gray"}`}>
        {offline
          ? OFFLINE_MSG
          : pending
            ? "Working…"
            : (msg?.text ??
              (dirty ? "Save the cutoff to see the new count." : !o.enabled && o.would_publish > 0 ? "Turn auto-approve on to publish the existing drafts." : null))}
      </p>
    </section>
  );
}
