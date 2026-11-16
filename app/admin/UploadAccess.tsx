"use client";

import { useState } from "react";
import { setUploadAccess } from "@/app/upload/actions";
import { OFFLINE_MSG, useOffline } from "@/lib/offline/status";

const OPTIONS = [
  { v: 1, label: "Admins only" },
  { v: 2, label: "Admins + Pro" },
  { v: 0, label: "Off" },
] as const;

/** Who may upload charts (/upload). The database enforces it; this only changes the setting. */
export default function UploadAccess({ initial }: { initial: 0 | 1 | 2 }) {
  const [value, setValue] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const offline = useOffline();
  const pick = async (v: 0 | 1 | 2) => {
    if (v === value || busy) return;
    if (offline) return setMsg(OFFLINE_MSG);
    setBusy(true);
    setMsg(null);
    const r = await setUploadAccess(v);
    setBusy(false);
    if (r.ok) setValue(v);
    else setMsg(r.error);
  };
  return (
    <section className="bb-panel mb-8 flex flex-col gap-3 p-4" aria-label="Audio upload">
      <h2 className="text-xl font-semibold">Audio upload</h2>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Who can upload">
        {OPTIONS.map((o) => (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={value === o.v}
            disabled={busy}
            onClick={() => pick(o.v)}
            className={`bb-btn h-12 px-4 text-lg font-semibold ${value === o.v ? "bb-on" : "bb-btn-secondary"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="text-base text-bb-cue-gray">
        Pro = the emails in the PRO_EMAILS setting on Vercel. Off stops new uploads for everyone; existing charts stay.
      </p>
      {msg && (
        <p role="alert" className="bb-error px-3 py-2 text-lg">
          {msg}
        </p>
      )}
    </section>
  );
}
