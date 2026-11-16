"use client";

// One of your own uploaded charts: the chart in any key, numbers or chord names, the
// cheat sheet, stage mode and setlists. Private: only you can open it.
import Link from "next/link";
import { useEffect, useState } from "react";
import AddToSetlist from "@/app/setlists/AddToSetlist";
import Chart from "@/app/songs/[slug]/Chart";
import { DisplayControls, KeyInfo } from "@/app/songs/[slug]/controls";
import { FONTS, useChartState } from "@/app/songs/[slug]/hooks";
import { enterFullscreen } from "@/app/songs/[slug]/SongView";
import CheatSheet from "@/app/upload/CheatSheet";
import { rememberMine, type MineChart } from "@/lib/upload/mine";

export default function MineView({ chart, offline = false }: { chart: MineChart; offline?: boolean }) {
  const s = useChartState(chart.slug, chart.chart_text);
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    if (!offline) void rememberMine(chart);
  }, [chart, offline]);
  const act = "bb-btn bb-btn-secondary h-12 px-4 text-lg font-semibold";
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-2">
      <h1 className="text-3xl font-bold tracking-tight">{chart.title}</h1>
      {chart.artist && <p className="text-lg text-bb-cue-gray">{chart.artist}</p>}
      <p className="mb-3 mt-1 text-base text-bb-cue-gray">Your private chart (draft from an upload: check it by ear).</p>
      <div className="mb-3 flex flex-wrap gap-2">
        <Link href={`/mine/${chart.id}/stage`} onClick={enterFullscreen} className="bb-btn bb-btn-primary h-12 px-5 text-lg font-bold">
          Stage mode
        </Link>
        <button type="button" className={`${act} ${sheet ? "bb-on" : ""}`} onClick={() => setSheet(!sheet)} aria-expanded={sheet}>
          Cheat sheet
        </button>
        {!offline && (
          <>
            <Link href={`/upload/${chart.id}`} className={act}>
              Edit
            </Link>
            <AddToSetlist slug={chart.slug} title={chart.title} variant="button" />
          </>
        )}
      </div>
      {sheet && (
        <div className="bb-panel mb-4 px-4 py-4">
          <CheatSheet text={chart.chart_text} />
        </div>
      )}
      {s.view ? (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <DisplayControls s={s} />
          </div>
          <KeyInfo s={s} />
          <div className="mt-4">
            <Chart view={s.view} chords={s.chords} fontFamily={FONTS[s.font].css} fontWeight={FONTS[s.font].weight} style={{ fontSize: "clamp(1.6rem, 7vw, 2.4rem)" }} />
          </div>
        </>
      ) : (
        <p className="bb-error px-3 py-2 text-lg">{s.error}</p>
      )}
    </main>
  );
}
