"use client";

// The one-screen structure summary for a fill-in player: form line, how it starts and
// ends, and the watch-outs. Read from the chart text (lib/upload/structure). Used in stage
// mode, the print view and the shared link. Never shows audio.
import { useMemo } from "react";
import { CUE_LABEL, readStructure, type Structure } from "@/lib/upload/structure";

export function useStructure(text: string): Structure | null {
  return useMemo(() => {
    try {
      return readStructure(text);
    } catch {
      return null;
    }
  }, [text]);
}

export function startLine(s: Structure) {
  return s.start.cue ? CUE_LABEL[s.start.cue] : `Unclear: ${s.start.unclear ?? "check by ear"}`;
}
export function endLine(s: Structure) {
  return s.ending.cue ? CUE_LABEL[s.ending.cue] : `Unclear: ${s.ending.unclear ?? "check by ear"}`;
}

export default function CheatSheet({ text, header, big = false }: { text: string; header?: React.ReactNode; big?: boolean }) {
  const s = useStructure(text);
  if (!s) return <p className="text-lg text-bb-cue-gray">The chart has a format error, so the cheat sheet can&apos;t be read.</p>;
  const row = big ? "text-2xl" : "text-lg";
  return (
    <div className="flex flex-col gap-3">
      {header}
      <p className={`${big ? "text-3xl" : "text-xl"} font-bold leading-snug`}>{s.formLine}</p>
      <dl className={`grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 ${row}`}>
        <dt className="text-bb-cue-gray">Starts</dt>
        <dd className={s.start.cue ? "font-semibold" : "text-bb-downbeat-amber"}>{startLine(s)}</dd>
        <dt className="text-bb-cue-gray">Ends</dt>
        <dd className={s.ending.cue ? "font-semibold" : "text-bb-downbeat-amber"}>{endLine(s)}</dd>
        <dt className="text-bb-cue-gray">Solos</dt>
        <dd className={s.hasSolo ? "font-semibold" : "text-bb-downbeat-amber"}>
          {s.hasSolo ? s.parts.filter((p) => p.name === "Solo").map((p) => p.label).join(", ") : "Unclear: check by ear"}
        </dd>
      </dl>
      {s.watch.length > 0 && (
        <ul className={`flex flex-col gap-1 ${row}`}>
          {s.watch.map((w, i) => (
            <li key={i} className={w.unclear ? "text-bb-downbeat-amber" : ""}>
              • {w.text}
              {w.unclear ? " (unclear)" : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
