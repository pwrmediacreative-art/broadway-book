"use client";

// New chart, first screen: the header on one short screen, then straight into the editor.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { headerError } from "@/lib/make/model";
import { OFFLINE_MSG, useOffline } from "@/lib/offline/status";
import { createChart } from "./actions";
import HeaderFields, { type HeaderValue } from "./HeaderFields";

export default function NewChartForm({ setlist }: { setlist: string | null }) {
  const router = useRouter();
  const offline = useOffline();
  const [v, setV] = useState<HeaderValue>({ title: "", artist: "", key: null, time: "4/4", bpm: null });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bad = headerError(v);

  const make = async () => {
    if (bad || busy || offline) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await createChart({ ...v, setlist });
      if (!r.ok) return setErr(r.error);
      const q = new URLSearchParams();
      if (setlist) q.set("setlist", setlist);
      if (r.setlistError) q.set("setlistError", "1");
      const qs = q.toString();
      router.push(`/make/${r.id}${qs ? `?${qs}` : ""}`);
    } catch {
      setErr("Couldn't make the chart. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void make();
      }}
      className="flex flex-col gap-5"
    >
      <HeaderFields value={v} onChange={setV} autoFocus />
      {setlist && <p className="text-lg text-bb-cue-gray">It goes on the end of your setlist.</p>}
      {err && <p className="bb-error px-3 py-2 text-lg">{err}</p>}
      {offline && <p className="bb-notice text-lg">{OFFLINE_MSG}</p>}
      <button type="submit" disabled={!!bad || busy || offline} className="bb-btn bb-btn-primary h-14 w-full text-xl font-bold">
        {busy ? "Making…" : "Start the chart"}
      </button>
      {bad && v.title === "" && <p className="-mt-3 text-base text-bb-cue-gray">A title is all you need to start.</p>}
    </form>
  );
}
