"use client";

// The "Song details" card above the chart. Every edit here rewrites the chart text (one
// source of truth), "+ Add…" answers included; the Save button stores it (and the server
// notes what was filled in: "added by a player", the owner's count).
import { useState } from "react";
import { SECTION_NAMES, type SectionName } from "@/lib/chart/types";
import { addCue, CUE_LABEL, cueLabel, END_CUES, removeCue, renamePart, setEnding, setRepeat, setStart, songMap, START_CUES } from "@/lib/upload/structure";
import { applyDetail } from "@/lib/upload/details";
import { chipText, DetailRows, useStructure, type OnAdd } from "../CheatSheet";

const SECTION_LABEL: Record<SectionName, string> = {
  Intro: "Intro",
  V: "Verse (V)",
  Pre: "Pre-chorus (Pre)",
  C: "Chorus (C)",
  B: "Bridge (B)",
  Solo: "Solo",
  Turn: "Turnaround (Turn)",
  Tag: "Tag",
  Outro: "Outro",
};

export default function StructureCard({
  text,
  onChange,
  onJump,
  onLoop,
  onCheckEnding,
  checking,
  onAdd,
}: {
  text: string;
  onChange: (t: string) => void;
  onJump: (part: number) => void;
  onLoop: ((part: number) => void) | null;
  onCheckEnding: (() => void) | null;
  checking: boolean;
  /** "+ Add…" saved right away; without it the answer only edits the text (Save stores it). */
  onAdd?: OnAdd;
}) {
  const s = useStructure(text);
  const [editing, setEditing] = useState(false);
  const [cue, setCue] = useState<{ part: number; text: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!s) return <p className="bb-error px-4 py-3 text-lg">The chart has a format error. Fix it in the editor to see the structure.</p>;

  const apply = (fn: () => string) => {
    try {
      setErr(null);
      onChange(fn());
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const chip = "bb-btn h-12 px-3 text-lg font-bold";
  return (
    <section className="bb-panel flex flex-col gap-3 px-3 py-3" aria-label="Song details">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-2xl font-bold">Song details</h2>
        <button type="button" className={`bb-btn h-12 px-4 text-lg font-semibold ${editing ? "bb-on" : "bb-btn-secondary"}`} onClick={() => setEditing(!editing)}>
          {editing ? "Done" : "Edit"}
        </button>
      </div>

      <ul className="flex flex-wrap gap-2" aria-label="Song map">
        {songMap(s).map((c) =>
          c.name ? (
            <li key={c.part}>
              <button type="button" className={`${chip} bb-btn-secondary`} onClick={() => onJump(c.part)} aria-label={`${chipText(c, c.name)}. Go there`}>
                {chipText(c, c.name)}
              </button>
            </li>
          ) : (
            <li key={c.part}>
              <button
                type="button"
                className={`${chip} bb-btn-quiet border border-dashed border-bb-rule-gray font-semibold text-bb-cue-gray`}
                onClick={() => {
                  setEditing(true);
                  onJump(c.part);
                }}
              >
                + Name this section <span className="font-bb-data">·{c.bars}</span>
              </button>
            </li>
          ),
        )}
      </ul>

      <DetailRows
        s={s}
        onWatchTap={onJump}
        onAdd={onAdd ?? ((d) => {
          try {
            onChange(applyDetail(text, d));
            return null;
          } catch (e) {
            return (e as Error).message;
          }
        })}
      />

      {editing && (
        <div className="flex flex-col gap-4 border-t border-bb-rule-gray pt-3">
          <label className="flex flex-col gap-1 text-lg">
            How it starts
            <select
              className="bb-input h-12 px-2 text-lg"
              value={s.start.cue ?? ""}
              onChange={(e) => apply(() => setStart(text, e.target.value || null))}
            >
              <option value="">Not set</option>
              {s.start.cue && !(START_CUES as readonly string[]).includes(s.start.cue) && <option value={s.start.cue}>{cueLabel(s.start.cue)}</option>}
              {START_CUES.map((c) => (
                <option key={c} value={c}>
                  {CUE_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-lg">
            How it ends
            <select
              className="bb-input h-12 px-2 text-lg"
              value={s.ending.cue ?? ""}
              onChange={(e) => apply(() => setEnding(text, e.target.value || null))}
            >
              <option value="">Not set</option>
              {s.ending.cue && !(END_CUES as readonly string[]).includes(s.ending.cue) && <option value={s.ending.cue}>{cueLabel(s.ending.cue)}</option>}
              {END_CUES.map((c) => (
                <option key={c} value={c}>
                  {CUE_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          {onCheckEnding && (
            <button type="button" className="bb-btn bb-btn-secondary h-12 self-start px-4 text-lg" disabled={checking} onClick={onCheckEnding}>
              {checking ? "Listening to the ending…" : "Check the ending from the audio"}
            </button>
          )}

          <ul className="flex flex-col gap-3">
            {s.parts.map((p, i) => (
              <li key={p.line} className="flex flex-col gap-2 border-b border-bb-rule-gray pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label={`Section ${i + 1} name`}
                    className="bb-input h-12 min-w-0 flex-1 px-2 text-lg"
                    value={p.name}
                    onChange={(e) => apply(() => renamePart(text, p.line, e.target.value as SectionName, p.number))}
                  >
                    {SECTION_NAMES.map((n) => (
                      <option key={n} value={n}>
                        {SECTION_LABEL[n]}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label={`Section ${i + 1} number`}
                    inputMode="numeric"
                    className="bb-input h-12 w-16 px-2 text-center text-lg"
                    value={p.number ?? 1}
                    onChange={(e) => {
                      const n = Number(e.target.value.replace(/\D/g, "")) || 1;
                      apply(() => renamePart(text, p.line, p.name, Math.min(n, 9)));
                    }}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-lg">
                  <span className="text-bb-cue-gray">Play</span>
                  <button type="button" className="bb-btn bb-btn-secondary h-12 w-12 text-xl" aria-label="Fewer times" onClick={() => apply(() => setRepeat(text, p.line, (p.repeat ?? 1) - 1))}>
                    −
                  </button>
                  <span className="w-10 text-center font-bold">×{p.repeat ?? 1}</span>
                  <button type="button" className="bb-btn bb-btn-secondary h-12 w-12 text-xl" aria-label="More times" onClick={() => apply(() => setRepeat(text, p.line, (p.repeat ?? 1) + 1))}>
                    +
                  </button>
                  {p.guessed && (
                    <button type="button" className="bb-btn bb-btn-secondary h-12 px-3 text-lg" onClick={() => apply(() => renamePart(text, p.line, p.name, p.number))}>
                      Label looks right
                    </button>
                  )}
                  {onLoop && (
                    <button type="button" className="bb-btn bb-btn-secondary h-12 px-3 text-lg" onClick={() => onLoop(i)}>
                      Loop
                    </button>
                  )}
                  <button type="button" className="bb-btn bb-btn-quiet h-12 px-3 text-lg" onClick={() => setCue({ part: i, text: "" })}>
                    + Cue
                  </button>
                </div>
                {s.watch
                  .filter((w) => w.part === i && w.text.startsWith("“"))
                  .map((w) => {
                    const c = w.text.slice(1, w.text.indexOf("”"));
                    return (
                      <button key={c} type="button" className="bb-btn bb-btn-quiet h-11 self-start px-2 text-base" onClick={() => apply(() => removeCue(text, p.line, c))}>
                        Remove “{c}”
                      </button>
                    );
                  })}
                {cue?.part === i && (
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      apply(() => addCue(text, p.line, cue.text));
                      setCue(null);
                    }}
                  >
                    <input
                      autoFocus
                      aria-label="Cue, 6 words or fewer"
                      placeholder="band out, drums only… (no lyrics)"
                      className="bb-input h-12 min-w-0 flex-1 px-3 text-lg"
                      value={cue.text}
                      maxLength={60}
                      onChange={(e) => setCue({ part: i, text: e.target.value })}
                    />
                    <button className="bb-btn bb-btn-primary h-12 px-4 text-lg font-bold">Add</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {err && (
        <p role="alert" className="bb-error px-3 py-2 text-lg">
          {err}
        </p>
      )}
    </section>
  );
}
