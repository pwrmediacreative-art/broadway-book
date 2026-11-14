"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import SavedSet from "@/app/setlists/SavedSet";
import { savedSet, setKey } from "@/lib/offline/charts";
import { checkOffline } from "@/lib/offline/status";
import { rememberedUser } from "@/lib/offline/user";
import type { AccountSet } from "@/lib/setlists/api";

/** /offline/setlist?id=<setlist id> or ?code=<share code>, plus &play=1 to start in play mode. */
export default function SavedSetlistPage() {
  const params = useSearchParams();
  const id = params.get("id");
  const code = params.get("code");
  const play = params.get("play") === "1";
  const [set, setSet] = useState<AccountSet | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    (async () => {
      const uid = rememberedUser()?.id;
      const key = code ? setKey({ code }) : id && uid ? setKey({ uid, id }) : null;
      const found = key ? await savedSet(key) : null;
      if (!alive) return;
      // Not on this phone: if we're actually online, the real page has it.
      if (!found && (id || code) && !(await checkOffline())) {
        const base = code ? `/s/${encodeURIComponent(code)}` : `/setlists/${encodeURIComponent(id!)}`;
        return location.replace(base + (play ? "/play" : ""));
      }
      if (alive) setSet(found);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, code]);

  if (set === undefined) return null;
  if (!set) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-8 text-center">
        <p className="mb-6 text-2xl">This setlist isn&apos;t saved on this phone yet.</p>
        <Link href="/setlists" className="inline-flex h-14 items-center justify-center rounded-lg bg-bb-downbeat-amber px-6 text-xl font-bold text-bb-stage-black active:opacity-80">
          Back to setlists
        </Link>
      </main>
    );
  }
  return <SavedSet set={set} id={code ? `s.${code}` : (id ?? "saved")} startPlaying={play} />;
}
