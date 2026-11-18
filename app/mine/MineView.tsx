"use client";

// One of your own uploaded charts: the chart in any key, numbers or chord names, the
// song details, stage mode and setlists. Private: only you can open it (and admins, for an
// admin's upload). Both can fill in missing song details ("+ Add…"), saved right away.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AddToSetlist from "@/app/setlists/AddToSetlist";
import Chart from "@/app/songs/[slug]/Chart";
import { DisplayControls, KeyInfo } from "@/app/songs/[slug]/controls";
import { FONTS, useChartState } from "@/app/songs/[slug]/hooks";
import { enterFullscreen } from "@/app/songs/[slug]/SongView";
import { addSongDetail } from "@/app/upload/actions";
import CheatSheet from "@/app/upload/CheatSheet";
import { OFFLINE_MSG, useOffline } from "@/lib/offline/status";
import { rememberMine, type MineChart } from "@/lib/upload/mine";

export default function MineView({ chart, offline = false }: { chart: MineChart; offline?: boolean }) {
  const router = useRouter();
  const lostSignal = useOffline();
  // a detail just saved shows at once; the page's own copy catches up on refresh
  const [saved, setSaved] = useState<{ from: string; text: string } | null>(null);
  const text = saved && saved.from === chart.chart_text ? saved.text : chart.chart_text;
  const s = useChartState(chart.slug, text);
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    if (!offline) void rememberMine(chart);
  }, [chart, offline]);
  const act = "bb-btn bb-btn-secondary h-12 px-4 text-lg font-semibold";
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-2">
      <h1 className="text-3xl font-bold tracking-tight">{chart.title}</h1>
      {chart.artist && <p className="text-lg text-bb-cue-gray">{chart.artist}</p>}
      <p className="mb-3 mt-1 text-base text-bb-cue-gray">
        {chart.mine === false
          ? `${chart.made ? "Made" : "Uploaded"} by ${chart.by ?? "another admin"}. Admins only`
          : chart.locked
            ? "Your chart, waiting for library votes"
            : "Your private chart"}
        .
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        <Link href={`/mine/${chart.id}/stage`} onClick={enterFullscreen} className="bb-btn bb-btn-primary h-12 px-5 text-lg font-bold">
          Stage mode
        </Link>
        <button type="button" className={`${act} ${sheet ? "bb-on" : ""}`} onClick={() => setSheet(!sheet)} aria-expanded={sheet}>
          Song details
        </button>
        {!offline && (
          <>
            {chart.mine !== false && (
              <Link href={chart.made ? `/make/${chart.id}` : `/upload/${chart.id}`} className={act}>
                {chart.locked ? "Library votes" : "Edit"}
              </Link>
            )}
            <AddToSetlist slug={chart.slug} title={chart.title} variant="button" />
          </>
        )}
      </div>
      {sheet && (
        <div className="bb-panel mb-4 px-4 py-4">
          <CheatSheet
            text={text}
            onJump={(part) => document.querySelectorAll("[data-section]")[part]?.scrollIntoView({ block: "start" })}
            nameHref={chart.mine !== false && !offline ? (chart.made ? `/make/${chart.id}` : `/upload/${chart.id}`) : undefined}
            onAdd={
              offline || chart.locked
                ? undefined
                : async (d) => {
                    if (lostSignal) return OFFLINE_MSG;
                    const r = await addSongDetail(chart.id, d);
                    if (!r.ok) return r.error;
                    setSaved({ from: chart.chart_text, text: r.text });
                    router.refresh();
                    return null;
                  }
            }
          />
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
