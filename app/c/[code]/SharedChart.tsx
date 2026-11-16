"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Chart from "@/app/songs/[slug]/Chart";
import { DisplayControls, KeyInfo } from "@/app/songs/[slug]/controls";
import { FONTS, useChartState } from "@/app/songs/[slug]/hooks";
import CheatSheet from "@/app/upload/CheatSheet";
import { browserClient } from "@/lib/supabase/browser";

type Shared = { title: string; artist: string | null; chart_text: string };

export default function SharedChart({ code }: { code: string }) {
  const valid = /^[A-Za-z0-9_-]{16,}$/.test(code);
  const [data, setData] = useState<Shared | null | undefined>(valid ? undefined : null);
  useEffect(() => {
    let alive = true;
    if (!valid) return;
    browserClient()
      .rpc("upload_shared", { p_code: code })
      .then(({ data }) => alive && setData((data as Shared | null) ?? null), () => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [code, valid]);
  if (data === undefined) return <p className="p-4 text-lg text-bb-cue-gray">Loading…</p>;
  if (data === null)
    return (
      <main className="mx-auto w-full max-w-md px-4 py-8">
        <p className="mb-4 text-xl">This link doesn&apos;t work anymore. Ask for a new one.</p>
        <Link href="/" className="bb-btn bb-btn-primary inline-flex h-12 items-center px-5 text-lg">
          Broadway Book
        </Link>
      </main>
    );
  return <Body code={code} data={data} />;
}

function Body({ code, data }: { code: string; data: Shared }) {
  const s = useChartState(`shared-${code}`, data.chart_text);
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-2">
      <h1 className="text-3xl font-bold tracking-tight">{data.title}</h1>
      {data.artist && <p className="text-lg text-bb-cue-gray">{data.artist}</p>}
      <p className="mb-4 mt-1 text-base text-bb-cue-gray">Shared with you to read. A draft chart: check it by ear.</p>
      <section className="bb-panel mb-4 px-4 py-4" aria-label="Structure">
        <h2 className="mb-2 text-2xl font-bold">Structure</h2>
        <CheatSheet text={data.chart_text} />
      </section>
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
