"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AddToSetlist from "@/app/setlists/AddToSetlist";
import Chart from "@/app/songs/[slug]/Chart";
import { DisplayControls, KeyInfo } from "@/app/songs/[slug]/controls";
import { FONTS, useChartState } from "@/app/songs/[slug]/hooks";
import { checkChart } from "@/lib/chart";
import { OFFLINE_MSG, useOffline } from "@/lib/offline/status";
import { checkAudio, uploadAudio } from "@/lib/upload/audio";
import { endingFromLoudness, rmsWindows } from "@/lib/upload/loudness";
import { CUE_LABEL, setEnding } from "@/lib/upload/structure";
import {
  attachAudio,
  deleteAudio,
  deletePrivateChart,
  rebuildPrivateChart,
  savePrivateChart,
  setPlaySync,
  setSharing,
} from "../actions";
import Player, { type PlayerHandle } from "./Player";
import StructureCard from "./StructureCard";

export interface UploadInfo {
  source: "musicxml" | "audio";
  hasAnalysis: boolean;
  confidence: number | null;
  estimated: boolean;
  edited: boolean;
  shareCode: string | null;
  sync: { start: number; bars: number } | null;
}

export default function Workspace({
  id,
  slug,
  initialText,
  info,
  audioUrl,
  maxMb,
}: {
  id: string;
  slug: string;
  initialText: string;
  info: UploadInfo;
  audioUrl: string | null;
  maxMb: number;
}) {
  const router = useRouter();
  const offline = useOffline();
  const [text, setText] = useState(initialText);
  const [saved, setSaved] = useState(initialText);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [edited, setEdited] = useState(info.edited);
  const [shareCode, setShareCode] = useState(info.shareCode);
  const [sync, setSync] = useState(info.sync);
  const [current, setCurrent] = useState<string | null>(null);
  const [loop, setLoop] = useState<{ from: number; to: number; label: string } | null>(null);
  const [ending, setEndingGuess] = useState<{ cue: string | null; why: string } | null>(null);
  const player = useRef<PlayerHandle>(null);
  const chartBox = useRef<HTMLDivElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const dirty = text !== saved;
  const check = useMemo(() => checkChart(text), [text]);
  const s = useChartState(slug, check.ok ? text : saved);
  const unclear = (text.match(/^# UNCLEAR:/gm) ?? []).length;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // bars in play order ("section.bar", repeats written out) + where each section starts
  const { order, starts } = useMemo(() => {
    const order: string[] = [];
    const starts: { from: number; to: number; label: string }[] = [];
    s.view?.sections.forEach((sec, i) => {
      const ids: string[] = [];
      for (const row of sec.rows) for (const c of row) if (c.kind === "bar") ids.push(`${i}.${ids.length}`);
      const from = order.length;
      for (let r = 0; r < Math.max(1, sec.repeat); r++) order.push(...ids);
      starts.push({ from, to: order.length, label: sec.label.replace(/ x\d+$/, "") });
    });
    return { order, starts };
  }, [s.view]);
  const beatsPerBar = Number((s.view?.meta.time ?? "4/4").split("/")[0]) || 4;
  const onBar = useCallback((b: string | null) => setCurrent(b), []);

  const run = async (label: string, fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done?: string) => {
    if (offline) return setMsg({ ok: false, text: OFFLINE_MSG });
    setBusy(label);
    setMsg(null);
    try {
      const r = await fn();
      if (!r.ok) setMsg({ ok: false, text: r.error });
      else if (done) setMsg({ ok: true, text: done });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    run("save", async () => {
      const r = await savePrivateChart(id, text);
      if (r.ok) {
        setText(r.text);
        setSaved(r.text);
        setEdited(true);
      }
      return r;
    }, "Saved.");

  const jump = (part: number) => {
    const el = chartBox.current?.querySelectorAll("section")[part];
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (starts[part]) player.current?.seekStep(starts[part].from);
  };
  const tapBar = (barId: string) => {
    const step = order.indexOf(barId);
    if (step >= 0) player.current?.seekStep(step);
  };

  const checkEnding = async () => {
    if (!audioUrl) return;
    setBusy("ending");
    setEndingGuess(null);
    try {
      const buf = await (await fetch(audioUrl)).arrayBuffer();
      const ctx = new AudioContext();
      const audio = await ctx.decodeAudioData(buf);
      await ctx.close();
      const ch = audio.getChannelData(0);
      const tail = ch.subarray(Math.max(0, ch.length - Math.round(audio.sampleRate * 45)));
      setEndingGuess(endingFromLoudness(rmsWindows(tail, audio.sampleRate)));
    } catch {
      setEndingGuess({ cue: null, why: "This browser couldn't read the audio to check." });
    } finally {
      setBusy(null);
    }
  };

  const addAudio = async (f: File | undefined) => {
    if (!f) return;
    const c = await checkAudio(f, maxMb);
    if ("error" in c) return setMsg({ ok: false, text: c.error });
    await run("audio", async () => {
      const path = await uploadAudio(f, (p) => setMsg({ ok: true, text: `Uploading audio ${Math.round(p * 100)}%` }));
      const r = await attachAudio(id, path, Math.round(c.seconds * 10) / 10);
      if (r.ok) router.refresh();
      return r;
    }, "Audio added.");
  };

  const shareUrl = shareCode && typeof window !== "undefined" ? `${window.location.origin}/c/${shareCode}` : null;
  const act = "bb-btn bb-btn-secondary h-12 px-4 text-lg font-semibold";

  return (
    <div className="flex flex-col gap-4">
      <div className="bb-notice px-4 py-3 text-lg">
        <b>From a chord file.</b>
        <span className="block text-base text-bb-cue-gray">
          {info.confidence !== null && `${Math.round(info.confidence * 100)}% sure${info.estimated ? " (estimated from the timing)" : ""} · `}
          {unclear === 0 ? "Nothing left to fill in" : `${unclear} spot${unclear === 1 ? "" : "s"} to fill in (the # notes in the chart text)`}
        </span>
      </div>

      <StructureCard
        text={check.ok ? text : saved}
        onChange={setText}
        onJump={jump}
        onLoop={audioUrl && sync ? (i) => starts[i] && setLoop(starts[i]) : null}
        onCheckEnding={audioUrl ? checkEnding : null}
        checking={busy === "ending"}
      />
      {ending && (
        <div className="bb-panel flex flex-col gap-2 px-3 py-3 text-lg">
          <p>
            {ending.cue ? <>Sounds like: <b>{CUE_LABEL[ending.cue]}</b>. </> : null}
            {ending.why}
          </p>
          {ending.cue && (
            <button
              type="button"
              className="bb-btn bb-btn-primary h-12 self-start px-4 text-lg font-bold"
              onClick={() => {
                setText(setEnding(text, ending.cue as "cold stop" | "repeat and fade"));
                setEndingGuess(null);
              }}
            >
              Use “{CUE_LABEL[ending.cue]}”
            </button>
          )}
        </div>
      )}

      {audioUrl ? (
        <Player
          ref={player}
          src={audioUrl}
          bpm={s.view?.meta.bpm ?? null}
          beatsPerBar={beatsPerBar}
          order={order}
          sync={sync}
          loop={loop}
          onLoopClear={() => setLoop(null)}
          onBar={onBar}
          onSync={(start) => {
            const next = { start, bars: order.length };
            setSync(next);
            run("sync", () => setPlaySync(id, next));
          }}
        />
      ) : (
        <div className="bb-panel flex flex-col gap-2 px-3 py-3">
          <p className="text-lg text-bb-cue-gray">No audio. Add the song&apos;s audio for the player, loop and slow-down.</p>
          <input ref={audioInput} type="file" accept=".mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav" className="hidden" onChange={(e) => addAudio(e.target.files?.[0])} />
          <button type="button" className={`${act} self-start`} disabled={!!busy || offline} onClick={() => audioInput.current?.click()}>
            Add audio
          </button>
        </div>
      )}

      {s.view && (
        <div className="flex flex-wrap items-center gap-2">
          <DisplayControls s={s} />
        </div>
      )}
      {s.view && <KeyInfo s={s} />}

      <div className="grid gap-4 md:grid-cols-2">
        <div ref={chartBox} className="order-1 min-w-0 md:order-2">
          {s.view ? (
            <Chart
              view={s.view}
              chords={s.chords}
              fontFamily={FONTS[s.font].css}
              fontWeight={FONTS[s.font].weight}
              style={{ fontSize: "clamp(1.6rem, 7vw, 2.4rem)" }}
              play={audioUrl && sync ? { current, onTap: tapBar } : undefined}
            />
          ) : (
            <p className="bb-error px-3 py-2 text-lg">{s.error}</p>
          )}
        </div>
        <div className="order-2 flex min-w-0 flex-col gap-2 md:order-1">
          <label htmlFor="chart-text" className="text-lg font-semibold">
            Chart text
          </label>
          <textarea
            id="chart-text"
            className="bb-input min-h-[24rem] w-full px-3 py-2 font-bb-data text-base leading-relaxed"
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {check.error && <p className="bb-error px-3 py-2 text-lg">Format error: {check.error}</p>}
          {check.longCues.length > 0 && <p className="bb-error px-3 py-2 text-lg">Cues are 6 words or fewer, never lyrics: “{check.longCues[0]}”</p>}
        </div>
      </div>

      <div className="sticky bottom-[var(--bb-tabs-bottom,0px)] z-10 -mx-4 flex flex-wrap items-center gap-2 border-t border-bb-rule-gray bg-bb-house-black px-4 py-3">
        <button type="button" className="bb-btn bb-btn-primary h-12 px-5 text-lg font-bold" disabled={!dirty || !check.ok || !!busy || offline} onClick={save}>
          {busy === "save" ? "Saving…" : dirty ? "Save" : "Saved"}
        </button>
        {dirty && (
          <button type="button" className="bb-btn bb-btn-quiet h-12 px-3 text-lg" onClick={() => setText(saved)}>
            Undo changes
          </button>
        )}
        <Link href={`/mine/${id}/stage`} className={act}>
          Stage mode
        </Link>
      </div>

      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`${msg.ok ? "bb-notice" : "bb-error"} px-4 py-3 text-lg`}>
          {msg.text}
        </p>
      )}
      {offline && <p className="text-lg text-bb-cue-gray">{OFFLINE_MSG}</p>}

      <div className="flex flex-wrap gap-2">
        <Link href={`/mine/${id}`} className={act}>
          View chart
        </Link>
        <Link href={`/upload/${id}/print`} className={act}>
          Print song details
        </Link>
        <Link href={`/upload/${id}/history`} className={act}>
          History
        </Link>
        <AddToSetlist slug={slug} title={s.view?.meta.title ?? "this chart"} variant="button" />
        {info.hasAnalysis && (
          <button
            type="button"
            className={act}
            disabled={!!busy || offline}
            onClick={() => {
              if ((edited || dirty) && !confirm("Rebuild the chart from the file? Your edits are replaced (the edited version stays in history).")) return;
              run("rebuild", async () => {
                const r = await rebuildPrivateChart(id);
                if (r.ok) {
                  setText(r.text);
                  setSaved(r.text);
                  setEdited(false);
                }
                return r;
              }, "Rebuilt from the file.");
            }}
          >
            Rebuild chart
          </button>
        )}
      </div>

      <section className="bb-panel flex flex-col gap-2 px-3 py-3" aria-label="Share">
        <h2 className="text-xl font-bold">Share with a fill-in player</h2>
        <p className="text-base text-bb-cue-gray">A view-only link to the structure and chart. Never the audio.</p>
        {shareUrl && (
          <div className="flex flex-wrap items-center gap-2">
            <input readOnly className="bb-input h-12 min-w-0 flex-1 px-3 text-base" value={shareUrl} onFocus={(e) => e.target.select()} aria-label="Share link" />
            <button type="button" className={act} onClick={() => navigator.clipboard?.writeText(shareUrl).then(() => setMsg({ ok: true, text: "Link copied." }))}>
              Copy
            </button>
          </div>
        )}
        <button
          type="button"
          className={`${act} self-start`}
          disabled={!!busy || offline}
          onClick={() =>
            run("share", async () => {
              const r = await setSharing(id, !shareCode);
              if (r.ok) setShareCode(r.code);
              return r;
            }, shareCode ? "Sharing stopped. The old link no longer works." : "Link ready.")
          }
        >
          {shareCode ? "Stop sharing" : "Make a share link"}
        </button>
      </section>

      <section className="flex flex-col gap-2 border-t border-bb-rule-gray pt-4" aria-label="Delete">
        {audioUrl && (
          <button
            type="button"
            className="bb-btn bb-btn-danger h-12 self-start px-4 text-lg"
            disabled={!!busy || offline}
            onClick={() => {
              if (!confirm("Delete the audio file and its analysis? Your chart stays.")) return;
              run("delaudio", async () => {
                const r = await deleteAudio(id);
                if (r.ok) router.refresh();
                return r;
              }, "Audio deleted.");
            }}
          >
            Delete audio
          </button>
        )}
        <button
          type="button"
          className="bb-btn bb-btn-danger h-12 self-start px-4 text-lg"
          disabled={!!busy || offline}
          onClick={() => {
            if (!confirm("Delete this chart, its history, its audio and its share link? This can't be undone.")) return;
            run("delete", async () => {
              const r = await deletePrivateChart(id);
              if (r.ok) router.push("/upload");
              return r;
            });
          }}
        >
          Delete chart
        </button>
      </section>
    </div>
  );
}
