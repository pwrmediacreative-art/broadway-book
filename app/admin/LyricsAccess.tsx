"use client";

import { useState } from "react";
import { setLyricsAudience } from "@/app/api/lyrics/actions";
import { OFFLINE_MSG, useOffline } from "@/lib/offline/status";

const OPTIONS = [
  { v: 0, label: "Off" },
  { v: 1, label: "Admins only" },
  { v: 2, label: "Signed-in players" },
  { v: 3, label: "Everyone" },
] as const;
type Audience = 0 | 1 | 2 | 3;

/** Who may see lyrics (live from LRCLIB). The database enforces it; Off is the kill switch. */
export default function LyricsAccess({ initial }: { initial: Audience }) {
  const [value, setValue] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const offline = useOffline();
  const pick = async (v: Audience) => {
    if (v === value || busy) return;
    if (offline) return setMsg(OFFLINE_MSG);
    setBusy(true);
    setMsg(null);
    const r = await setLyricsAudience(v);
    setBusy(false);
    if (r.ok) setValue(v);
    else setMsg(r.error);
  };
  return (
    <section className="bb-panel mb-8 flex flex-col gap-3 p-4" aria-label="Lyrics">
      <h2 className="text-xl font-semibold">Lyrics</h2>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Who can see lyrics">
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
        Live from LRCLIB, never stored by us. Off hides lyrics everywhere at once, including copies on phones the next time they open. Never shown to search engines.
      </p>
      {msg && (
        <p role="alert" className="bb-error px-3 py-2 text-lg">
          {msg}
        </p>
      )}
    </section>
  );
}
