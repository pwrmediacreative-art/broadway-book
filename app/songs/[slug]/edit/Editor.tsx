"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { buildView, checkChart, diffCharts, diffDocs, parseChart } from "@/lib/chart";
import { PREF, setPref } from "@/lib/prefs";
import { loadMyVersions, useMyVersions } from "@/lib/personal/versions";
import { propose, savePersonal, updateProposal } from "@/app/community/actions";
import BarDiff, { DiffSummary } from "@/app/community/BarDiff";
import Chart from "../Chart";
import { locateBar, refAt, refKey, sectionBars, spotLabel, type BarRef } from "@/lib/flags/ref";
import { FONTS } from "../hooks";

interface Props {
  song: { id: string; slug: string; title: string };
  publicText: string;
  publicRevisionId: string | null;
  proposal: { id: string; chart_text: string; note: string; base_text: string | null; stale: boolean } | null;
  intent: "suggest" | null;
  /** Opened from a long-press "Suggest an edit": the held spot and which chart it was on. */
  focus?: { section: number; bar: number; beat: number; from: "public" | "mine" } | null;
}

type Msg = { ok: boolean; text: string; stale?: boolean } | null;

export default function Editor({ song, publicText, publicRevisionId, proposal, intent, focus = null }: Props) {
  const router = useRouter();
  const { list, ready } = useMyVersions();
  const mine = list.find((v) => v.song_id === song.id) ?? null;

  const [text, setText] = useState(proposal?.chart_text ?? publicText);
  const [note, setNote] = useState(proposal?.note ?? "");
  const [source, setSource] = useState<"public" | "mine" | "proposal">(proposal ? "proposal" : "public");
  const [tab, setTab] = useState<"preview" | "changes">("preview");
  const [msg, setMsg] = useState<Msg>(null);
  const [noteMissing, setNoteMissing] = useState(false);
  const [pending, start] = useTransition();
  const touched = useRef(false);

  // Start from the player's own version when they have one (unless editing a suggestion).
  useEffect(() => {
    if (proposal || touched.current || !mine || focus?.from === "public") return;
    setText(mine.chart_text);
    setNote(intent === "suggest" ? (mine.note ?? "") : "");
    setSource("mine");
  }, [mine, proposal, intent, focus]);

  const check = useMemo(() => checkChart(text), [text]);
  const publicDoc = useMemo(() => parseChart(publicText).doc, [publicText]);
  const view = useMemo(() => (check.doc ? buildView(check.doc) : null), [check.doc]);
  const diff = useMemo(() => (check.doc ? diffDocs(publicDoc, check.doc) : null), [check.doc, publicDoc]);
  const publicMoved = useMemo(() => {
    if (!proposal?.stale || !proposal.base_text) return null;
    try {
      return diffCharts(proposal.base_text, publicText);
    } catch {
      return null;
    }
  }, [proposal, publicText]);
  const unchanged = !!diff && diff.changedRows === 0;

  // Long-press "Suggest an edit": once the starting chart is settled, select that bar in the
  // chart text and scroll it into view, outline it in the preview, then focus the note.
  const spot = useMemo<{ ref: BarRef; split: boolean } | null>(() => {
    const ref = focus && view ? refAt(view, focus.section, focus.bar, focus.beat) : null;
    return ref && view ? { ref, split: (sectionBars(view, ref.section)[ref.bar]?.length ?? 1) > 1 } : null;
  }, [focus, view]);
  const focused = useRef(false);
  useEffect(() => {
    if (!focus || focused.current || touched.current) return;
    if (focus.from === "mine" && (!ready || (mine && source !== "mine"))) return;
    focused.current = true;
    const v = view;
    const ref = v && refAt(v, focus.section, focus.bar, focus.beat);
    const at = ref && locateBar(text, focus.section, focus.bar);
    const box = document.getElementById("chart") as HTMLTextAreaElement | null;
    if (ref && at && box) {
      box.setSelectionRange(at.start, at.end);
      const line = text.slice(0, at.start).split("\n").length - 1;
      const lh = parseFloat(getComputedStyle(box).lineHeight) || 28;
      box.scrollTop = Math.max(0, line * lh - box.clientHeight / 3);
    }
    document.getElementById("note")?.focus();
  }, [focus, ready, mine, source, view, text]);

  const edit = (t: string) => {
    touched.current = true;
    setText(t);
    setMsg(null);
  };
  const loadFrom = (which: "public" | "mine") => {
    touched.current = true;
    setText(which === "mine" && mine ? mine.chart_text : publicText);
    setSource(which);
    setMsg(null);
  };

  const needNote = () => {
    if (note.trim().length >= 3) return false;
    setNoteMissing(true);
    setMsg({ ok: false, text: "Add a short note so voters know what you changed." });
    document.getElementById("note")?.focus();
    return true;
  };

  const saveMine = () =>
    start(async () => {
      const r = await savePersonal({ songId: song.id, chartText: text, note, basedOn: publicRevisionId });
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      await loadMyVersions();
      setPref(PREF.showPublic(song.slug), null, "session");
      router.push(`/songs/${song.slug}`);
    });

  const suggest = () => {
    if (needNote()) return;
    start(async () => {
      const r = await propose({ songId: song.id, chartText: text, note, baseRevisionId: publicRevisionId });
      if (!r.ok) return setMsg({ ok: false, text: r.error, stale: r.stale });
      router.push(`/community/${r.id}`);
    });
  };

  const update = () => {
    if (!proposal || needNote()) return;
    start(async () => {
      const r = await updateProposal({ id: proposal.id, chartText: text, note });
      if (!r.ok) return setMsg({ ok: false, text: r.error, stale: r.stale });
      router.push(`/community/${proposal.id}`);
    });
  };

  return (
    <>
      <div className="mb-1 flex items-center justify-between gap-2">
        <Link
          href={proposal ? `/community/${proposal.id}` : `/songs/${song.slug}`}
          className="inline-flex h-12 items-center text-lg text-muted active:text-foreground"
        >
          ← Cancel
        </Link>
      </div>
      <h1 className="text-3xl font-bold leading-tight">{proposal ? "Edit your suggestion" : "Change this chart"}</h1>
      <p className="mb-3 text-lg text-muted">{song.title}</p>

      {proposal?.stale && (
        <div className="mb-4 rounded-xl border border-amber-400/60 bg-amber-400/10 p-4 text-lg text-amber-100">
          <p>
            The public chart changed after you suggested this. Bring your change onto the newest chart, then save. Votes
            start over.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button className="min-h-12 rounded-xl bg-accent px-4 text-lg font-bold text-black" onClick={() => loadFrom("public")}>
              Start from the newest chart
            </button>
          </div>
          {publicMoved && (
            <details className="mt-3">
              <summary className="min-h-11 cursor-pointer">
                What changed in the public chart (<DiffSummary diff={publicMoved} />)
              </summary>
              <BarDiff diff={publicMoved} className="mt-2 text-foreground" />
            </details>
          )}
        </div>
      )}

      {!proposal && ready && mine && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-lg">
          <span className="text-muted">Starting from:</span>
          {(["mine", "public"] as const).map((w) => (
            <button
              key={w}
              onClick={() => loadFrom(w)}
              aria-pressed={source === w}
              className={`min-h-11 rounded-full border px-4 ${source === w ? "border-accent bg-accent font-semibold text-black" : "border-line bg-panel"}`}
            >
              {w === "mine" ? "Your version" : "Public chart"}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label htmlFor="chart" className="text-sm text-muted">
            Chart text
          </label>
          <textarea
            id="chart"
            value={text}
            onChange={(e) => edit(e.target.value)}
            rows={14}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="min-h-72 w-full rounded-xl border border-line bg-panel p-3 font-mono text-lg leading-relaxed"
          />
          <Status check={check} />
          <details className="text-base text-muted">
            <summary className="min-h-11 cursor-pointer">Chart format cheat sheet</summary>
            <ul className="mt-1 list-inside list-disc leading-relaxed">
              <li>
                <code>[V]</code> <code>[C x2]</code> sections · <code>|</code> starts a new line
              </li>
              <li>
                <code>1 4 5 6-</code> one bar each · <code>(1 4)</code> two chords in one bar · <code>%</code> repeat
              </li>
              <li>
                <code>^4</code> push · <code>&lt;1&gt;</code> hold · <code>5~</code> fermata · <code>5!</code> stop · <code>NC</code>
              </li>
              <li>
                <code>&quot;drums only&quot;</code> cue, 6 words max. Never lyrics.
              </li>
            </ul>
          </details>
        </div>

        <div>
          <div role="tablist" className="mb-2 grid grid-cols-2 gap-2">
            {(["preview", "changes"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`min-h-12 rounded-xl border text-lg ${tab === t ? "border-accent bg-accent font-semibold text-black" : "border-line bg-panel"}`}
              >
                {t === "preview" ? "Preview" : `Changes${diff && diff.changedBars ? ` (${diff.changedBars})` : ""}`}
              </button>
            ))}
          </div>
          <div className="min-h-40 rounded-xl border border-line p-3">
            {tab === "preview" ? (
              view ? (
                <Chart
                  view={view}
                  chords={false}
                  fontFamily={FONTS.atkinson.css}
                  fontWeight={FONTS.atkinson.weight}
                  style={{ fontSize: "clamp(1.3rem, 5.5vw, 1.9rem)" }}
                  hold={spot ? { flagged: new Set(), selected: refKey(spot.ref) } : undefined}
                />
              ) : (
                <p className="text-lg text-muted">Fix the format error to see the preview.</p>
              )
            ) : diff ? (
              <>
                <p className="mb-2 text-lg text-muted">
                  Compared with the public chart: <DiffSummary diff={diff} />
                </p>
                <BarDiff diff={diff} />
              </>
            ) : (
              <p className="text-lg text-muted">Fix the format error to see the changes.</p>
            )}
          </div>
        </div>
      </div>

      <label className="mt-5 flex flex-col gap-1">
        {spot && (
          <span className="text-lg text-accent">
            Editing: {spotLabel(spot.ref, spot.split)} ({spot.ref.text})
          </span>
        )}
        <span className="text-lg font-semibold">
          Note <span className="font-normal text-muted">{proposal ? "(required)" : "(required for everyone, optional just for you)"}</span>
        </span>
        <input
          id="note"
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setNoteMissing(false);
          }}
          maxLength={500}
          placeholder="e.g. Bridge goes to the 6-, not the 4"
          aria-invalid={noteMissing}
          className={`min-h-12 rounded-xl border bg-panel px-4 text-lg ${noteMissing ? "border-red-400" : "border-line"}`}
        />
      </label>

      {msg && (
        <div role="status" className={`mt-3 text-lg ${msg.ok ? "text-emerald-300" : "text-red-300"}`}>
          {msg.text}
          {msg.stale && (
            <button className="ml-2 min-h-11 underline" onClick={() => router.refresh()}>
              Load the newest chart
            </button>
          )}
        </div>
      )}

      {proposal ? (
        <div className="mt-5">
          <SaveButton onClick={update} disabled={pending || !check.ok} title="Update suggestion" sub="Everyone will see it. Votes start over." primary />
        </div>
      ) : (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <SaveButton
            onClick={saveMine}
            disabled={pending || !check.ok}
            title="Just for me"
            sub="Only you will see this. Saved to your account, no vote."
            primary={intent !== "suggest"}
          />
          <SaveButton
            onClick={suggest}
            disabled={pending || !check.ok || unchanged}
            title="Suggest for everyone"
            sub={unchanged ? "Change something first." : "Everyone will see it after 3 players approve."}
            primary={intent === "suggest"}
          />
        </div>
      )}
    </>
  );
}

function SaveButton({ onClick, disabled, title, sub, primary }: { onClick: () => void; disabled: boolean; title: string; sub: string; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-20 w-full flex-col items-start justify-center rounded-2xl border-2 px-5 py-3 text-left active:opacity-80 disabled:opacity-40 ${
        primary ? "border-accent bg-accent text-black" : "border-line bg-panel"
      }`}
    >
      <span className="text-xl font-bold">{title}</span>
      <span className={`text-base ${primary ? "text-black/75" : "text-muted"}`}>{sub}</span>
    </button>
  );
}

function Status({ check }: { check: ReturnType<typeof checkChart> }) {
  if (check.error) return <p className="text-lg text-red-300">Format error: {check.error}</p>;
  if (check.longCues.length)
    return (
      <p className="text-lg text-red-300">
        Cue too long (6 words max, never lyrics): “{check.longCues[0]}”
      </p>
    );
  return (
    <p className="text-lg text-emerald-300">
      ✓ Chart reads fine{check.warnings.length ? <span className="text-amber-200"> · {check.warnings.join(" · ")}</span> : null}
    </p>
  );
}
