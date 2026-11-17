"use client";

// "Song details": the one-screen summary for a fill-in player. The song map (section chips,
// tap one to jump there), how it starts and ends, solo spots and the watch-outs. Read from
// the chart text (lib/upload/structure). Used on the uploaded chart's page, in stage mode,
// the print view and the shared link. Never shows audio.
// With onAdd (people who may add details: the owner, admins on an admin's upload) a missing
// detail reads "+ Add how it starts" and opens a small editor (lib/upload/details). Without
// it, a missing detail shows nothing (no disclaimers).
import Link from "next/link";
import { useMemo, useState } from "react";
import { END_PICKS, KEY_PICKS, openDetails, OTHER_WORDS, START_PICKS, STOP_PICKS, type DetailInput } from "@/lib/upload/details";
import { cueLabel, readStructure, songMap, type MapChip, type Structure } from "@/lib/upload/structure";

/** Save one detail; returns an error message, or null when it worked. */
export type OnAdd = (d: DetailInput) => Promise<string | null> | string | null;

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
  return s.start.cue ? cueLabel(s.start.cue) : null;
}
export function endLine(s: Structure) {
  return s.ending.cue ? cueLabel(s.ending.cue) : null;
}

/** "Verse ·16 ×2" (the chip text, no "+ Name" fallback). */
export const chipText = (c: MapChip, name: string) => `${name} ·${c.bars}${c.repeat ? ` ×${c.repeat}` : ""}`;

/** A section's name for players ("Verse 2"), "Section 3" while nobody has named it. */
const partName = (s: Structure, part: number) => songMap(s)[part]?.name ?? `Section ${part + 1}`;

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

/**
 * A detail a player filled in: dotted underline; tap (or hover) shows "Added by a player".
 * onTap: what a tap does besides (the owner's card jumps to the section).
 */
function Added({ on, onTap, children }: { on: boolean; onTap?: () => void; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!on)
    return onTap ? (
      <button type="button" className="min-h-11 text-left" onClick={onTap}>
        {children}
      </button>
    ) : (
      <>{children}</>
    );
  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        title="Added by a player"
        aria-expanded={open}
        className="min-h-11 text-left underline decoration-bb-cue-gray decoration-dotted underline-offset-4"
        onClick={() => {
          setOpen(!open);
          onTap?.();
        }}
      >
        {children}
      </button>
      {open && <span className="text-sm font-normal text-bb-cue-gray">Added by a player</span>}
    </span>
  );
}

type Target = { field: DetailInput["field"]; part?: number };
const sameTarget = (a: Target | null, b: Target) => !!a && a.field === b.field && a.part === b.part;

/**
 * Starts / Ends / Solos, the "+ Add…" prompts (with onAdd) and the watch-outs. Shared by
 * CheatSheet and the owner's Song details card (app/upload/[id]/StructureCard.tsx).
 */
export function DetailRows({ s, big = false, onAdd, onWatchTap }: { s: Structure; big?: boolean; onAdd?: OnAdd; onWatchTap?: (part: number) => void }) {
  const [open, setOpen] = useState<Target | null>(null);
  const gaps = onAdd ? openDetails(s) : null;
  const row = big ? "text-2xl" : "text-lg";
  const prompts: { label: string; target: Target }[] = gaps
    ? [
        ...(gaps.start ? [{ label: "Add how it starts", target: { field: "start" as const } }] : []),
        ...(gaps.ending ? [{ label: "Add the ending", target: { field: "ending" as const } }] : []),
        ...(gaps.solo ? [{ label: "Add solo spots", target: { field: "solo" as const } }] : []),
        ...(gaps.stop ? [{ label: "Add stops and breaks", target: { field: "stop" as const } }] : []),
        ...gaps.key.map((part) => ({ label: `Add the key change in ${partName(s, part)}`, target: { field: "key" as const, part } })),
      ]
    : [];
  const solos = s.solos.map((x) => `${partName(s, x.part)}${x.who ? ` (${x.who})` : ""}`).join(", ");
  // the key questions are prompts for people who can add; for everyone else a calm line
  const watch = s.watch.filter((w) => w.kind !== "solo" && !(gaps && w.kind === "keyq"));
  return (
    <>
      {(s.start.cue || s.ending.cue || s.hasSolo) && (
        <dl className={`grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1 ${row}`}>
          {s.start.cue && (
            <>
              <dt className="text-bb-cue-gray">Starts</dt>
              <dd className="font-semibold">
                <Added on={s.start.byPlayer}>{startLine(s)}</Added>
              </dd>
            </>
          )}
          {s.ending.cue && (
            <>
              <dt className="text-bb-cue-gray">Ends</dt>
              <dd className="font-semibold">
                <Added on={s.ending.byPlayer}>{endLine(s)}</Added>
              </dd>
            </>
          )}
          {s.hasSolo && (
            <>
              <dt className="text-bb-cue-gray">Solos</dt>
              <dd className="font-semibold">
                <Added on={s.solos.some((x) => x.byPlayer)}>{solos}</Added>
              </dd>
            </>
          )}
        </dl>
      )}
      {prompts.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Add song details">
          {prompts.map((p) => (
            <li key={`${p.target.field}${p.target.part ?? ""}`} className="flex flex-col gap-2">
              <button
                type="button"
                aria-expanded={sameTarget(open, p.target)}
                onClick={() => setOpen(sameTarget(open, p.target) ? null : p.target)}
                className={`bb-btn bb-btn-quiet min-h-12 justify-start self-start border border-dashed border-bb-rule-gray px-3 text-left ${row} font-semibold text-bb-cue-gray`}
              >
                + {p.label}
              </button>
              {sameTarget(open, p.target) && onAdd && <DetailEditor s={s} target={p.target} onAdd={onAdd} onDone={() => setOpen(null)} />}
            </li>
          ))}
        </ul>
      )}
      {watch.length > 0 && (
        <ul className={`flex flex-col gap-1 ${row}`}>
          {watch.map((w, i) => (
            <li key={i}>
              <Added on={w.byPlayer} onTap={onWatchTap && (() => onWatchTap(w.part))}>
                • {named(s, w.part, w.text)}
              </Added>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const TITLE: Record<DetailInput["field"], string> = {
  start: "How it starts",
  ending: "How it ends",
  solo: "Solo spots",
  stop: "Stops and breaks",
  key: "Key change",
};

/** The small "+ Add…" editor: quick-pick chips plus a few words of your own. */
function DetailEditor({ s, target, onAdd, onDone }: { s: Structure; target: Target; onAdd: OnAdd; onDone: () => void }) {
  const [pick, setPick] = useState<string | null>(null);
  const [other, setOther] = useState("");
  const [parts, setParts] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const f = target.field;
  const picks = f === "start" ? START_PICKS : f === "ending" ? END_PICKS : f === "stop" ? STOP_PICKS : f === "key" ? KEY_PICKS : [];
  const otherLabel = f === "key" ? "New key" : "Other";
  const typing = f === "solo" || pick === "other";
  const picked = pick !== null && (pick !== "other" || other.trim() !== "");
  const ready = f === "solo" ? parts.length > 0 : f === "stop" ? picked && parts.length > 0 : picked;
  const chip = (on: boolean) => `bb-btn h-12 px-3 text-lg font-semibold ${on ? "bb-on" : "bb-btn-secondary"}`;

  const save = async () => {
    const p = pick === "other" ? null : pick;
    const input: DetailInput =
      f === "solo"
        ? { field: "solo", parts, who: other }
        : f === "stop"
          ? { field: "stop", parts, pick: p, other }
          : f === "key"
            ? { field: "key", part: target.part ?? -1, pick: p, other }
            : { field: f, pick: p, other };
    setBusy(true);
    setErr(null);
    try {
      const e = await onAdd(input);
      if (e) setErr(e);
      else onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-3 border-y border-bb-rule-gray py-3"
      aria-label={TITLE[f]}
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !busy) void save();
      }}
    >
      <p className="text-lg font-semibold">{f === "key" ? `Key change in ${partName(s, target.part ?? 0)}` : TITLE[f]}</p>
      {picks.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={f === "stop" ? "What" : TITLE[f]}>
          {[...picks, ["other", otherLabel] as const].map(([value, label]) => (
            <button key={value} type="button" aria-pressed={pick === value} className={chip(pick === value)} onClick={() => setPick(pick === value ? null : value)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {(f === "solo" || f === "stop") && (
        <div className="flex flex-col gap-2">
          <span className="text-base text-bb-cue-gray">{f === "solo" ? "Which sections" : "Where"}</span>
          <div className="flex flex-wrap gap-2" role="group" aria-label={f === "solo" ? "Which sections" : "Where"}>
            {s.parts.map((_, i) => {
              const on = parts.includes(i);
              return (
                <button key={i} type="button" aria-pressed={on} className={chip(on)} onClick={() => setParts(on ? parts.filter((x) => x !== i) : [...parts, i])}>
                  {partName(s, i)}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {typing && (
        <input
          autoFocus={f !== "solo"}
          aria-label={f === "solo" ? "Who plays it (optional)" : f === "key" ? "The new key" : `${otherLabel}, ${OTHER_WORDS} words or fewer`}
          placeholder={
            f === "solo" ? "Who plays it? guitar, fiddle… (optional)" : f === "key" ? "D, Bb, F#m…" : f === "stop" ? "a few words (no lyrics)" : `${OTHER_WORDS} words or fewer (no lyrics)`
          }
          className="bb-input h-12 min-w-0 px-3 text-lg"
          value={other}
          maxLength={60}
          onChange={(e) => setOther(e.target.value)}
        />
      )}
      {err && (
        <p role="alert" className="bb-error px-3 py-2 text-lg">
          {err}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="bb-btn bb-btn-secondary h-12 px-5 text-lg font-bold" disabled={!ready || busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="bb-btn bb-btn-quiet h-12 px-3 text-lg" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function CheatSheet({
  text,
  header,
  big = false,
  onJump,
  nameHref,
  onAdd,
}: {
  text: string;
  header?: React.ReactNode;
  big?: boolean;
  onJump?: (part: number) => void;
  nameHref?: string;
  onAdd?: OnAdd;
}) {
  const s = useStructure(text);
  if (!s) return <p className="text-lg text-bb-cue-gray">The chart has a format error, so the song details can&apos;t be read.</p>;
  return (
    <div className="flex flex-col gap-3">
      {header}
      <SongMap s={s} big={big} onJump={onJump} nameHref={nameHref} />
      <DetailRows s={s} big={big} onAdd={onAdd} />
    </div>
  );
}
