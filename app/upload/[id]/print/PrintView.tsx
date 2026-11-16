"use client";

import Link from "next/link";
import Chart from "@/app/songs/[slug]/Chart";
import { FONTS, useChartState } from "@/app/songs/[slug]/hooks";
import CheatSheet from "@/app/upload/CheatSheet";
import { pretty } from "@/lib/chart";
import type { MineChart } from "@/lib/upload/mine";

// Stage mode's Light look (DESIGN.md): the only light screen, made for paper and screenshots.
export default function PrintView({ chart }: { chart: MineChart }) {
  const s = useChartState(chart.slug, chart.chart_text);
  const v = s.view;
  return (
    <div className="bb-stage-light fixed inset-0 z-50 overflow-y-auto bg-bb-house-black text-bb-chart-white print:static print:overflow-visible">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-4">
        <div className="flex flex-wrap gap-2 print:hidden">
          <Link href={`/upload/${chart.id}`} className="bb-btn bb-btn-secondary inline-flex h-12 items-center px-4 text-lg">
            ‹ Back
          </Link>
          <button type="button" className="bb-btn bb-btn-primary h-12 px-5 text-lg font-bold" onClick={() => window.print()}>
            Print
          </button>
        </div>
        <CheatSheet
          text={chart.chart_text}
          header={
            <div>
              <h1 className="text-3xl font-bold">{chart.title}</h1>
              <p className="text-2xl font-bold">
                {[v?.keyShort && pretty(v.keyShort), v?.meta.bpm && `${v.meta.bpm} bpm`, v?.meta.time].filter(Boolean).join(" · ")}
              </p>
              {chart.artist && <p className="text-lg text-bb-cue-gray">{chart.artist}</p>}
            </div>
          }
        />
        {v && (
          <div className="border-t border-bb-rule-gray pt-3">
            <Chart view={v} chords={s.chords} fontFamily={FONTS[s.font].css} fontWeight={FONTS[s.font].weight} style={{ fontSize: "22px" }} />
          </div>
        )}
        <p className="text-base text-bb-cue-gray">Draft from an upload. Check it by ear. Broadway Book</p>
      </div>
    </div>
  );
}
