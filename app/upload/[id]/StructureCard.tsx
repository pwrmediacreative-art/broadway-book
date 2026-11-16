"use client";

// The "Structure" card above the chart. Every edit here rewrites the chart text (one
// source of truth); the Save button stores it.
import { useState } from "react";
import { SECTION_NAMES, type SectionName } from "@/lib/chart/types";
import { addCue, CUE_LABEL, END_CUES, removeCue, renamePart, setEnding, setRepeat, setStart, START_CUES } from "@/lib/upload/structure";
import { endLine, startLine, useStructure } from "../CheatSheet";

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
}: {
  text: string;
  onChange: (t: string) => void;
  onJump: (part: number) => void;
  onLoop: ((part: number) => void) | null;
  onCheckEnding: (() => void) | null;
  checking: boolean;
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
    <section className="bb-panel flex flex-col gap-3 px-3 py-3" aria-label="Structure">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-2xl font-bold">Structure</h2>
        <button type="button" className={`bb-btn h-12 px-4 text-lg font-semibold ${editing ? "bb-on" : "bb-btn-secondary"}`} onClick={() => setEditing(!editing)}>
          {editing ? "Done" : "Edit"}
        </button>
      </div>

      <div className="flex flex-wrap gap-2" role="list" aria-label="Song form">
        {s.parts.map((p, i) => (
          <button
            key={p.line}
            role="listitem"
            type="button"
            className={`${chip} ${p.guessed ? "bb-btn-secondary border-bb-downbeat-amber" : "bb-btn-secondary"}`}
            onClick={() => onJump(i)}
            aria-label={`${p.label}, ${p.bars} bars${p.repeat ? `, ${p.repeat} times` : ""}${p.guessed ? ", label guessed" : ""}. Go there`}
          >
            {p.label} {p.bars}
            {p.repeat ? ` ×${p.repeat}` : ""}
            {p.guessed && <span className="ml-1 text-bb-downbeat-amber">?</span>}
          </button>
        ))}
      </div>
      {s.parts.some((p) => p.guessed) && (
        <p className="text-base text-bb-downbeat-amber">? = label guessed from the repeat pattern. Edit to set it or confirm it.</p>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-lg">
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
        <ul className="flex flex-col gap-1 text-lg">
          {s.watch.map((w, i) => (
            <li key={i}>
              <button type="button" className={`min-h-11 text-left ${w.unclear ? "text-bb-downbeat-amber" : ""}`} onClick={() => onJump(w.part)}>
                • {w.text}
                {w.unclear ? " (unclear)" : ""}
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <div className="flex flex-col gap-4 border-t border-bb-rule-gray pt-3">
          <label className="flex flex-col gap-1 text-lg">
            How it starts
            <select
              className="bb-input h-12 px-2 text-lg"
              value={s.start.cue ?? ""}
              onChange={(e) => apply(() => setStart(text, (e.target.value || null) as (typeof START_CUES)[number] | null))}
            >
              <option value="">Not set</option>
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
              onChange={(e) => apply(() => setEnding(text, (e.target.value || null) as (typeof END_CUES)[number] | null))}
            >
              <option value="">Not set</option>
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
