"use client";

// "Song details": the one-screen summary for a fill-in player. The song map (section chips,
// tap one to jump there), how it starts and ends, and the watch-outs. Read from the chart text
// (lib/upload/structure). Used on the uploaded chart's page, in stage mode, the print view and
// the shared link. Never shows audio.
import Link from "next/link";
import { useMemo } from "react";
import { CUE_LABEL, readStructure, songMap, type MapChip, type Structure } from "@/lib/upload/structure";

export function useStructure(text: string): Structure | null {
  return useMemo(() => {
    try {
      return readStructure(text);
    } catch {
      return null;
    }
  }, [text]);
}

/** Known starts/endings only; an unknown one shows nothing to players (no disclaimers). */
export function startLine(s: Structure) {
  return s.start.cue ? CUE_LABEL[s.start.cue] : null;
}
export function endLine(s: Structure) {
  return s.ending.cue ? CUE_LABEL[s.ending.cue] : null;
}

/** "Verse ·16 ×2" (the chip text, no "+ Name" fallback). */
export const chipText = (c: MapChip, name: string) => `${name} ·${c.bars}${c.repeat ? ` ×${c.repeat}` : ""}`;

/**
 * The song map as chips. onJump: tapping a chip goes to that section (else plain text, e.g.
 * print). nameHref: where "+ Name this section" leads (the chart's owner); without it an
 * unnamed part reads "Section".
 */
export function SongMap({ s, big = false, onJump, nameHref }: { s: Structure; big?: boolean; onJump?: (part: number) => void; nameHref?: string }) {
  const chips = songMap(s);
  const size = big ? "min-h-14 px-4 text-2xl" : "min-h-12 px-3 text-lg";
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Song map">
      {chips.map((c) => {
        const label = c.name ? chipText(c, c.name) : null;
        if (!label && nameHref)
          return (
            <li key={c.part}>
              <Link href={nameHref} className={`bb-btn bb-btn-quiet ${size} border border-dashed border-bb-rule-gray font-semibold text-bb-cue-gray`}>
                + Name this section <span className="font-bb-data">·{c.bars}</span>
              </Link>
            </li>
          );
        const text = label ?? chipText(c, "Section");
        return (
          <li key={c.part}>
            {onJump ? (
              <button type="button" onClick={() => onJump(c.part)} aria-label={`${text}. Go there`} className={`bb-btn bb-btn-secondary ${size} font-bold`}>
                {text}
              </button>
            ) : (
              <span className={`inline-flex items-center rounded-bb-control border border-bb-rule-gray ${size} font-bold`}>{text}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Watch-out text with the section's real name ("Stop in Chorus bar 4", not "in C"). */
export function named(s: Structure, part: number, text: string): string {
  const p = s.parts[part];
  const name = songMap(s)[part]?.name;
  if (!p || !name) return text;
  // the label is always last ("… in V2", "… in V2 bar 3", "Solo: Solo2")
  return text.replace(new RegExp(`(\\s)${p.label}(?=(?: bar \\d+)?$)`), `$1${name}`);
}

export default function CheatSheet({
  text,
  header,
  big = false,
  onJump,
  nameHref,
}: {
  text: string;
  header?: React.ReactNode;
  big?: boolean;
  onJump?: (part: number) => void;
  nameHref?: string;
}) {
  const s = useStructure(text);
  if (!s) return <p className="text-lg text-bb-cue-gray">The chart has a format error, so the song details can&apos;t be read.</p>;
  const row = big ? "text-2xl" : "text-lg";
  return (
    <div className="flex flex-col gap-3">
      {header}
      <SongMap s={s} big={big} onJump={onJump} nameHref={nameHref} />
      <dl className={`grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 ${row}`}>
        {s.start.cue && (
          <>
            <dt className="text-bb-cue-gray">Starts</dt>
            <dd className="font-semibold">{startLine(s)}</dd>
          </>
        )}
        {s.ending.cue && (
          <>
            <dt className="text-bb-cue-gray">Ends</dt>
            <dd className="font-semibold">{endLine(s)}</dd>
          </>
        )}
        {s.hasSolo && (
          <>
            <dt className="text-bb-cue-gray">Solos</dt>
            <dd className="font-semibold">{songMap(s).filter((c) => s.parts[c.part].name === "Solo").map((c) => c.name).join(", ")}</dd>
          </>
        )}
      </dl>
      {s.watch.length > 0 && (
        <ul className={`flex flex-col gap-1 ${row}`}>
          {s.watch.map((w, i) => (
            <li key={i} className={w.unclear ? "text-bb-downbeat-amber" : ""}>
              • {named(s, w.part, w.text)}
              {w.unclear ? " (unclear)" : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
