"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { OFFLINE_MSG, useOffline } from "@/lib/offline/status";
import { savePrivateChart } from "../../actions";

export default function GoBack({ id, text }: { id: string; text: string; when: string }) {
  const router = useRouter();
  const offline = useOffline();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="bb-btn bb-btn-secondary h-12 self-start px-4 text-lg"
        disabled={busy || offline}
        onClick={async () => {
          if (!confirm("Go back to this version? It becomes the current chart; your other versions stay here.")) return;
          setBusy(true);
          const r = await savePrivateChart(id, text);
          setBusy(false);
          if (r.ok) router.push(`/upload/${id}`);
          else setErr(r.error);
        }}
      >
        {busy ? "Going back…" : "Go back to this version"}
      </button>
      {offline && <p className="text-base text-bb-cue-gray">{OFFLINE_MSG}</p>}
      {err && <p className="bb-error px-3 py-2 text-lg">{err}</p>}
    </>
  );
}
