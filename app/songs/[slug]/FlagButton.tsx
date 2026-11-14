"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { browserClient } from "@/lib/supabase/browser";
import { FLAG_REASONS, type FlagReason } from "@/lib/review/unclear";
import { flagChart } from "./flag-actions";
import { isOffline, OFFLINE_MSG } from "@/lib/offline/status";

/** "Flag a problem": signed-in players report a wrong chart. Enough flags alert the admins. */
export default function FlagButton({ slug, songId }: { slug: string; songId: string }) {
  const [open, setOpen] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [reason, setReason] = useState<FlagReason | null>(null);
  const [details, setDetails] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const toggle = async () => {
    if (!open && signedIn === null) {
      const { data } = await browserClient().auth.getSession();
      setSignedIn(!!data.session);
    }
    setOpen((o) => !o);
  };

  const send = () =>
    start(async () => {
      if (isOffline()) return setMsg({ ok: false, text: OFFLINE_MSG });
      if (!reason) return setMsg({ ok: false, text: "Pick what's wrong." });
      const r = await flagChart(songId, reason, details);
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setMsg({ ok: true, text: r.already ? "You already flagged this chart. Thanks!" : "Thanks! We'll take a look." });
      setReason(null);
      setDetails("");
    });

  return (
    <div>
      <button type="button" onClick={toggle} aria-expanded={open} className="inline-flex min-h-11 items-center text-lg text-bb-cue-gray underline">
        ⚑ Flag a problem with this chart
      </button>
      {open && (
        <div className="bb-panel mt-2 p-4">
          {signedIn === false ? (
            <p className="text-lg">
              <Link href={`/login?next=${encodeURIComponent(`/songs/${slug}`)}`} className="text-bb-chart-white underline">
                Sign in
              </Link>{" "}
              to flag a chart.
            </p>
          ) : msg?.ok ? (
            <p role="status" className="text-lg text-bb-chart-white">✓ {msg.text}</p>
          ) : (
            <>
              <fieldset className="mb-3">
                <legend className="mb-2 text-lg font-semibold">What&apos;s wrong?</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(Object.keys(FLAG_REASONS) as FlagReason[]).map((k) => (
                    <label key={k} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-bb-control border px-3 text-lg ${reason === k ? "bb-on" : "border-bb-rule-gray"}`}>
                      <input type="radio" name="flag-reason" value={k} checked={reason === k} onChange={() => setReason(k)} className="size-5" />
                      {FLAG_REASONS[k]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label htmlFor="flag-details" className="mb-1 block text-base text-bb-cue-gray">
                Where? (optional, e.g. “chorus bar 3 should be 4”)
              </label>
              <textarea
                id="flag-details"
                value={details}
                onChange={(e) => setDetails(e.target.value.slice(0, 300))}
                rows={2}
                className="bb-input mb-3 w-full p-3 text-lg"
              />
              <button type="button" onClick={send} disabled={pending} className="bb-btn bb-btn-primary min-h-12 px-5 text-lg">
                {pending ? "Sending…" : "Send flag"}
              </button>
              {msg && !msg.ok && <p className="bb-error mt-2 text-lg">{msg.text}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
