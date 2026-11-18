"use client";

// A player's own chart sent to the library: voters read the whole chart in the normal chart
// view (Numbers/Chords and the key picker work), since there is no earlier version to compare.
import Chart from "@/app/songs/[slug]/Chart";
import { DisplayControls, KeyInfo } from "@/app/songs/[slug]/controls";
import { FONTS, useChartState } from "@/app/songs/[slug]/hooks";

export default function SubmittedChart({ text, prefKey }: { text: string; prefKey: string }) {
  const s = useChartState(prefKey, text);
  if (!s.view) return <p className="bb-error px-3 py-2 text-lg">This chart can&apos;t be shown: {s.error}</p>;
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <DisplayControls s={s} />
      </div>
      <KeyInfo s={s} />
      <div className="mt-3">
        <Chart view={s.view} chords={s.chords} fontFamily={FONTS[s.font].css} fontWeight={FONTS[s.font].weight} style={{ fontSize: "clamp(1.4rem, 6vw, 2.2rem)" }} />
      </div>
    </>
  );
}
