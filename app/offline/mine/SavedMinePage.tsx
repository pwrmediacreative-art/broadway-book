"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import MineView from "@/app/mine/MineView";
import StageView from "@/app/songs/[slug]/StageView";
import { checkOffline } from "@/lib/offline/status";
import { savedMine, type MineChart } from "@/lib/upload/mine";

/** /offline/mine?id=<id>[&stage=1] */
export default function SavedMinePage() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const stage = params.get("stage") === "1";
  const [chart, setChart] = useState<MineChart | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    (async () => {
      const c = await savedMine(id).catch(() => null);
      if (!c && /^[0-9a-f-]{36}$/.test(id) && !(await checkOffline())) return location.replace(`/mine/${id}${stage ? "/stage" : ""}`);
      if (alive) setChart(c);
    })();
    return () => {
      alive = false;
    };
  }, [id, stage]);
  if (chart === undefined) return null;
  if (!chart)
    return (
      <main className="mx-auto w-full max-w-md px-4 py-8">
        <p className="mb-4 text-xl">This chart isn&apos;t saved on this phone yet. Open it once while you&apos;re online.</p>
        <Link href="/" className="bb-btn bb-btn-primary inline-flex h-12 items-center px-5 text-lg">
          Home
        </Link>
      </main>
    );
  if (stage) return <StageView slug={chart.slug} title={chart.title} chartText={chart.chart_text} neighbors={{ prev: null, next: null }} mine={{ id: chart.id }} />;
  return <MineView chart={chart} offline />;
}
