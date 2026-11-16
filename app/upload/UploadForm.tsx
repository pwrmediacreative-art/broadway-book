"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { OFFLINE_MSG, useOffline } from "@/lib/offline/status";
import { checkAudio, uploadAudio } from "@/lib/upload/audio";
import { createFromMusicXml } from "./actions";

const MAX_XML = 2 * 1024 * 1024;

type Step = { kind: "idle" } | { kind: "uploading"; pct: number } | { kind: "building" } | { kind: "ready" } | { kind: "error"; message: string };

/** Pull the title out of the file (MusicXML work title), else the file name. */
function titleFrom(xml: string, fileName: string): string {
  const t = /<work-title>([^<]{1,200})<\/work-title>/.exec(xml)?.[1] ?? /<movement-title>([^<]{1,200})<\/movement-title>/.exec(xml)?.[1];
  const clean = (s: string) => s.replace(/&amp;/g, "&").replace(/\s+-\s+Chord Chart$/i, "").trim();
  return clean(t ?? fileName.replace(/\.(musicxml|xml)$/i, ""));
}

export default function UploadForm({ maxMb }: { maxMb: number }) {
  const router = useRouter();
  const offline = useOffline();
  const [xml, setXml] = useState<{ name: string; text: string } | null>(null);
  const [audio, setAudio] = useState<{ file: File; seconds: number } | null>(null);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const xmlInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const busy = step.kind === "uploading" || step.kind === "building" || step.kind === "ready";

  const pickXml = async (f: File | undefined) => {
    setStep({ kind: "idle" });
    if (!f) return;
    if (/\.mxl$/i.test(f.name)) return setStep({ kind: "error", message: "That's a compressed .mxl file. Export it from Moises as uncompressed MusicXML (.musicxml)." });
    if (!/\.(musicxml|xml)$/i.test(f.name)) return setStep({ kind: "error", message: "Pick a .musicxml file." });
    if (f.size > MAX_XML) return setStep({ kind: "error", message: "That file is over 2 MB." });
    const text = await f.text();
    if (!/<score-partwise[\s>]/.test(text)) return setStep({ kind: "error", message: "That doesn't look like a MusicXML chord chart." });
    setXml({ name: f.name, text });
    if (!title) setTitle(titleFrom(text, f.name));
  };

  const pickAudio = async (f: File | undefined) => {
    setStep({ kind: "idle" });
    if (!f) return setAudio(null);
    const c = await checkAudio(f, maxMb);
    if ("error" in c) {
      setAudio(null);
      if (audioInput.current) audioInput.current.value = "";
      return setStep({ kind: "error", message: c.error });
    }
    setAudio({ file: f, seconds: c.seconds });
  };

  const submit = async () => {
    if (!xml || busy || offline) return;
    let audioPath: string | null = null;
    try {
      if (audio) {
        setStep({ kind: "uploading", pct: 0 });
        audioPath = await uploadAudio(audio.file, (p) => setStep({ kind: "uploading", pct: Math.round(p * 100) }));
      }
      setStep({ kind: "building" });
      const r = await createFromMusicXml({ xml: xml.text, title, artist, audioPath, audioSeconds: audio ? Math.round(audio.seconds * 10) / 10 : null });
      if (!r.ok) return setStep({ kind: "error", message: r.error });
      setStep({ kind: "ready" });
      router.push(`/upload/${r.id}`);
    } catch (e) {
      setStep({ kind: "error", message: (e as Error).message });
    }
  };

  const pick = "bb-btn bb-btn-secondary flex min-h-14 w-full items-center justify-between gap-3 px-4 text-left text-lg";
  return (
    <div className="flex flex-col gap-4">
      <p className="bb-notice px-4 py-3 text-lg">Only upload music you have the right to use. Your audio stays private.</p>

      <input ref={xmlInput} type="file" accept=".musicxml,.xml,application/vnd.recordare.musicxml+xml,text/xml" className="hidden" onChange={(e) => pickXml(e.target.files?.[0])} />
      <button type="button" className={pick} disabled={busy} onClick={() => xmlInput.current?.click()}>
        <span className="min-w-0">
          <span className="block font-semibold">Chord chart file</span>
          <span className="block truncate text-base text-bb-cue-gray">{xml ? xml.name : "Moises .musicxml export (required)"}</span>
        </span>
        <span aria-hidden className="text-bb-cue-gray">{xml ? "Change" : "Choose"}</span>
      </button>

      <input ref={audioInput} type="file" accept=".mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav" className="hidden" onChange={(e) => pickAudio(e.target.files?.[0])} />
      <button type="button" className={pick} disabled={busy} onClick={() => audioInput.current?.click()}>
        <span className="min-w-0">
          <span className="block font-semibold">Audio (optional)</span>
          <span className="block truncate text-base text-bb-cue-gray">
            {audio ? `${audio.file.name} · ${Math.floor(audio.seconds / 60)}:${String(Math.round(audio.seconds % 60)).padStart(2, "0")}` : `MP3, M4A or WAV, up to ${maxMb} MB and 10 minutes. Adds the player.`}
          </span>
        </span>
        <span aria-hidden className="text-bb-cue-gray">{audio ? "Change" : "Choose"}</span>
      </button>
      {audio && (
        <button type="button" disabled={busy} className="bb-btn bb-btn-quiet h-12 self-start px-3 text-base" onClick={() => pickAudio(undefined)}>
          Remove audio
        </button>
      )}

      <label className="flex flex-col gap-1 text-lg">
        Title
        <input className="bb-input h-12 px-3 text-lg" value={title} maxLength={200} disabled={busy} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-lg">
        Artist <span className="text-base text-bb-cue-gray">(optional)</span>
        <input className="bb-input h-12 px-3 text-lg" value={artist} maxLength={200} disabled={busy} onChange={(e) => setArtist(e.target.value)} />
      </label>

      <button type="button" className="bb-btn bb-btn-primary h-14 text-xl font-bold" disabled={!xml || !title.trim() || busy || offline} onClick={submit}>
        Make draft chart
      </button>
      {offline && <p className="text-lg text-bb-cue-gray">{OFFLINE_MSG}</p>}

      <Progress step={step} hasAudio={!!audio} />
    </div>
  );
}

function Progress({ step, hasAudio }: { step: Step; hasAudio: boolean }) {
  if (step.kind === "idle") return null;
  if (step.kind === "error")
    return (
      <p role="alert" className="bb-error px-4 py-3 text-lg">
        {step.message}
      </p>
    );
  const stages = [...(hasAudio ? ["Uploading audio"] : []), "Building chart", "Ready"];
  const at = step.kind === "uploading" ? 0 : step.kind === "building" ? (hasAudio ? 1 : 0) : stages.length - 1;
  return (
    <div className="bb-panel flex flex-col gap-3 px-4 py-4" aria-live="polite">
      <ol className="flex flex-col gap-1 text-lg">
        {stages.map((s, i) => (
          <li key={s} className={i === at ? "font-bold text-bb-downbeat-amber" : i < at ? "text-bb-chart-white" : "text-bb-cue-gray"}>
            {i < at ? "✓ " : i === at ? "▸ " : "· "}
            {s}
            {i === at && step.kind === "uploading" ? ` ${step.pct}%` : ""}
          </li>
        ))}
      </ol>
      {step.kind === "uploading" && (
        <div className="h-3 w-full bg-bb-rule-gray" role="progressbar" aria-valuenow={step.pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-3 bg-bb-downbeat-amber" style={{ width: `${step.pct}%` }} />
        </div>
      )}
    </div>
  );
}
