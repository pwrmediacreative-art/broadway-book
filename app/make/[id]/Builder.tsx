"use client";

// The tap-to-build editor (Q16). Sections are cards of big tap targets; the number pad
// writes bars into the selected section; the normal chart view previews it the whole time.
// Every change is saved on its own a moment later (our normal chart text, checked by the
// server). Private until "Send to library"; while it waits for votes it is read-only.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Chart from "@/app/songs/[slug]/Chart";
import { DisplayControls, KeyInfo } from "@/app/songs/[slug]/controls";
import { FONTS, useChartState } from "@/app/songs/[slug]/hooks";
import { pretty, type BeatItem, type RowItem, type SectionLabel } from "@/lib/chart";
import {
  addBeat,
  addPart,
  changedBars,
  chord,
  cleanBpm,
  cleanNote,
  customNameError,
  dropBeat,
  duplicatePart,
  fromText,
  headerError,
  insertItems,
  isBar,
  KEY_CHANGES,
  keyChangeItems,
  lastBeat,
  makeLabel,
  MORE_QUALITIES,
  movePart,
  noteError,
  partName,
  removePart,
  renamePart,
  SECTION_TYPES,
  setItems,
  setRepeat,
  toggleQuality,
  toText,
  withLastBeat,
  type Made,
  type Part,
} from "@/lib/make/model";
import { OFFLINE_MSG, useOffline } from "@/lib/offline/status";
import { deleteChart, saveChart, submitChart, withdrawChart } from "../actions";
import HeaderFields from "../HeaderFields";
import { Chip, Pad, Sheet, sheetBtn, type PadKey, type PadState } from "./parts";

interface Sel {
  pid: string;
  at: number; // index of the selected item; -1 = start of the section
  replace: boolean; // a tapped bar: the next number replaces it
}

type SheetState =
  | null
  | { kind: "add" }
  | { kind: "header" }
  | { kind: "section"; pid: string }
  | { kind: "bar"; pid: string; at: number }
  | { kind: "note"; pid: string; at: number }
  | { kind: "more" }
  | { kind: "submit" }
  | { kind: "delete" };

const replaceAt = (items: RowItem[], at: number, it: RowItem) => items.map((x, i) => (i === at ? it : x));

export default function Builder({
  id,
  slug,
  initialText,
  locked: lockedAtLoad,
  proposalId: proposalAtLoad,
  setlist,
  setlistError,
}: {
  id: string;
  slug: string;
  initialText: string;
  locked: boolean;
  proposalId: string | null;
  setlist: string | null;
  setlistError: boolean;
}) {
  const router = useRouter();
  const offline = useOffline();
  const [made, setMade] = useState<Made>(() => fromText(initialText));
  const [sel, setSel] = useState<Sel | null>(null);
  const [acc, setAcc] = useState<"" | "b" | "#">("");
  const [slash, setSlash] = useState(false);
  const [split, setSplit] = useState(false);
  const [sheet, setSheet] = useState<SheetState>(() => (fromText(initialText).parts.length || lockedAtLoad ? null : { kind: "add" }));
  const [clip, setClip] = useState<RowItem | null>(null);
  const [undo, setUndo] = useState<{ made: Made; what: string } | null>(null);
  const [savedText, setSavedText] = useState(initialText);
  const [status, setStatus] = useState<"saved" | "saving" | "error">("saved");
  const [err, setErr] = useState<string | null>(null);
  const [locked, setLocked] = useState(lockedAtLoad);
  const [proposalId, setProposalId] = useState(proposalAtLoad);
  const [busy, setBusy] = useState(false);

  const text = toText(made);
  const s = useChartState(slug, text);
  const dirty = text !== savedText;

  // Autosave a moment after the last change (never while locked or offline).
  useEffect(() => {
    if (locked || !dirty || offline) return;
    const t = window.setTimeout(async () => {
      setStatus("saving");
      try {
        const r = await saveChart(id, text);
        if (r.ok) {
          setSavedText(text);
          setStatus("saved");
          setErr(null);
        } else {
          setStatus("error");
          setErr(r.error);
        }
      } catch {
        setStatus("error");
        setErr("Couldn't save. Check your connection.");
      }
    }, 1200);
    return () => window.clearTimeout(t);
  }, [id, text, dirty, locked, offline]);

  // Leaving with changes not saved yet: ask first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // "Section deleted · Undo" goes away after a while.
  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo(null), 8000);
    return () => window.clearTimeout(t);
  }, [undo]);

  // Bring the section being edited into view.
  const selPid = sel?.pid ?? null;
  useEffect(() => {
    if (selPid) document.getElementById(`part-${selPid}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selPid]);

  const part = sel ? made.parts.find((p) => p.id === sel.pid) : undefined;
  const items = part?.items ?? [];
  const cur = sel && sel.at >= 0 ? items[sel.at] : undefined;
  const curBar = isBar(cur) ? cur : undefined;
  const beat = curBar ? lastBeat(curBar) : null;

  const edit = (next: RowItem[], at: number, replace = false) => {
    if (!sel) return;
    setMade((m) => setItems(m, sel.pid, next));
    setSel({ pid: sel.pid, at, replace });
  };
  const onBeat = (f: (b: BeatItem) => BeatItem) => {
    if (!sel || !curBar) return;
    edit(replaceAt(items, sel.at, withLastBeat(curBar, f)), sel.at, false);
  };
  const resetPad = () => {
    setAcc("");
    setSlash(false);
    setSplit(false);
  };
  const select = (next: Sel | null) => {
    setSel(next);
    resetPad();
  };

  const onKey = (k: PadKey) => {
    if (!sel) return;
    switch (k.k) {
      case "digit": {
        const b = chord(acc, k.d);
        setAcc("");
        if (slash && curBar) {
          setSlash(false);
          return onBeat((x) => (x.kind === "chord" ? { ...x, bass: { acc, degree: k.d } } : x));
        }
        if (split && curBar) return edit(replaceAt(items, sel.at, addBeat(curBar, b)), sel.at);
        if (sel.replace && curBar) return edit(replaceAt(items, sel.at, b), sel.at);
        return edit(insertItems(items, sel.at + 1, [b]), sel.at + 1);
      }
      case "acc":
        return setAcc(acc === k.a ? "" : k.a);
      case "q":
        return onBeat((x) => (x.kind === "chord" ? { ...x, quality: toggleQuality(x.quality, k.q) } : x));
      case "slash":
        return setSlash(!slash);
      case "split":
        return setSplit(!split);
      case "mod":
        return onBeat((x) =>
          x.kind === "repeat"
            ? x
            : k.m === "diamond"
              ? { ...x, diamond: !x.diamond }
              : k.m === "push"
                ? { ...x, push: !x.push }
                : { ...x, end: x.end === "stop" ? "" : "stop" },
        );
      case "more":
        return setSheet({ kind: "more" });
      case "rstart":
        resetPad();
        return edit(insertItems(items, sel.at + 1, [{ kind: "repeatSign", side: "start", text: "" }]), sel.at + 1);
      case "rend":
        resetPad();
        return edit(insertItems(items, sel.at + 1, [{ kind: "repeatSign", side: "end", text: "" }]), sel.at + 1);
      case "note":
        return setSheet({ kind: "note", pid: sel.pid, at: sel.at + 1 });
      case "del": {
        if (sel.at < 0) return;
        if (split && curBar?.kind === "split") {
          const d = dropBeat(curBar);
          if (d) return edit(replaceAt(items, sel.at, d), sel.at);
        }
        resetPad();
        return edit(
          items.filter((_, i) => i !== sel.at),
          sel.at - 1,
        );
      }
      case "next":
        resetPad();
        return setSel({ ...sel, replace: false });
    }
  };

  const pad: PadState = {
    acc,
    slash,
    split,
    quality: beat?.kind === "chord" ? beat.quality : null,
    mods: beat && beat.kind !== "repeat" ? { diamond: beat.diamond, push: beat.push, stop: beat.end === "stop" } : null,
    canSplit: !!curBar && curBar.kind !== "repeat",
  };
  const barNo = part && sel ? items.slice(0, sel.at + 1).filter(isBar).length : 0;
  const where = part
    ? `${partName(part.label)}${curBar ? ` · bar ${barNo}${sel?.replace ? ": tap a number to change it" : ""}` : barNo ? ` · after bar ${barNo}` : " · tap numbers to add bars"}${
        slash ? " · bass note?" : split ? " · next number joins this bar" : ""
      }`
    : "";

  const deletePart = (p: Part) => {
    setUndo({ made, what: `${partName(p.label)} deleted.` });
    setMade((m) => removePart(m, p.id));
    if (sel?.pid === p.id) select(null);
    setSheet(null);
  };

  const run = async (f: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) => {
    if (offline) return setErr(OFFLINE_MSG);
    setBusy(true);
    setErr(null);
    try {
      const r = await f();
      if (!r.ok) setErr(r.error);
      else after?.();
    } catch {
      setErr("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const doneHref = setlist ? `/setlists/${setlist}` : `/mine/${id}`;
  const statusText = locked
    ? "Waiting for library votes"
    : offline
      ? dirty
        ? `Not saved. ${OFFLINE_MSG}`
        : "Saved"
      : status === "error"
        ? "Not saved"
        : status === "saving" || dirty
          ? "Saving…"
          : "Saved";

  return (
    <main className={`mx-auto w-full max-w-3xl px-4 pt-2 lg:max-w-7xl lg:px-8 ${sel && !locked ? "pb-[22rem]" : "pb-16"}`}>
      <div className="flex items-center justify-between gap-2">
        <Link href={doneHref} className="inline-flex h-12 items-center text-lg text-bb-cue-gray active:text-bb-chart-white">
          ← {setlist ? "Setlist" : "Done"}
        </Link>
        <p className={`text-base ${status === "error" && !locked ? "text-bb-stop-red" : "text-bb-cue-gray"}`} aria-live="polite">
          {statusText}
        </p>
      </div>

      <h1 className="text-3xl font-bold tracking-tight">{made.header.title || "Untitled"}</h1>
      <p className="flex flex-wrap items-center gap-x-3 text-lg text-bb-cue-gray">
        <span>
          {[made.header.artist, made.header.key ? `Key ${pretty(made.header.key)}` : "No key", made.header.time, made.header.bpm && `${made.header.bpm} bpm`]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {!locked && (
          <button type="button" onClick={() => setSheet({ kind: "header" })} className="inline-flex h-11 items-center text-bb-chart-white underline underline-offset-4">
            Song info
          </button>
        )}
      </p>

      {setlistError && <p className="bb-notice mt-3 text-lg">Couldn&apos;t add it to the setlist. Add it from the chart page.</p>}
      {err && <p className="bb-error mt-3 px-3 py-2 text-lg">{err}</p>}
      {undo && (
        <p className="bb-notice mt-3 flex items-center justify-between gap-2 text-lg">
          {undo.what}
          <button
            type="button"
            className={sheetBtn}
            onClick={() => {
              setMade(undo.made);
              setUndo(null);
            }}
          >
            Undo
          </button>
        </p>
      )}
      {locked && (
        <div className="bb-notice mt-3 text-lg">
          <p className="mb-2">
            <b>Waiting for library votes.</b> It goes live once enough players approve it. Withdraw it to make changes.
          </p>
          <div className="flex flex-wrap gap-2">
            {proposalId && (
              <Link href={`/community/${proposalId}`} className={sheetBtn}>
                See the votes
              </Link>
            )}
            <button
              type="button"
              disabled={busy || offline}
              className={sheetBtn}
              onClick={() =>
                run(
                  () => withdrawChart(id),
                  () => {
                    setLocked(false);
                    setProposalId(null);
                    router.refresh();
                  },
                )
              }
            >
              Withdraw
            </button>
          </div>
          {offline && <p className="mt-2">{OFFLINE_MSG}</p>}
        </div>
      )}

      <div className="mt-4 lg:grid lg:grid-cols-2 lg:gap-8">
        <section aria-label="Sections" className="flex flex-col gap-3">
          {made.parts.map((p, i) => {
            const diff = changedBars(made, p.id);
            let bar = -1;
            return (
              <div key={p.id} id={`part-${p.id}`} className={`border p-3 ${sel?.pid === p.id ? "border-bb-downbeat-amber" : "border-bb-rule-gray"}`}>
                <div className="mb-2 flex items-center gap-1">
                  <h2 className="min-w-0 flex-1 truncate text-xl font-bold text-bb-downbeat-amber">
                    {partName(p.label)}
                    {p.label.repeat ? <span className="ml-2 text-lg text-bb-chart-white">×{p.label.repeat}</span> : null}
                  </h2>
                  {!locked && (
                    <>
                      <button type="button" className="bb-btn bb-btn-secondary h-11 w-11 text-lg" aria-label={`Move ${partName(p.label)} up`} disabled={i === 0} onClick={() => setMade((m) => movePart(m, p.id, -1))}>
                        ↑
                      </button>
                      <button
                        type="button"
                        className="bb-btn bb-btn-secondary h-11 w-11 text-lg"
                        aria-label={`Move ${partName(p.label)} down`}
                        disabled={i === made.parts.length - 1}
                        onClick={() => setMade((m) => movePart(m, p.id, 1))}
                      >
                        ↓
                      </button>
                      <button type="button" className="bb-btn bb-btn-secondary h-11 px-3 text-lg" aria-label={`${partName(p.label)} options`} onClick={() => setSheet({ kind: "section", pid: p.id })}>
                        ⋯
                      </button>
                    </>
                  )}
                </div>
                {p.from && diff.size > 0 && <p className="mb-2 text-base text-bb-cue-gray">Lit bars differ from the section it was copied from.</p>}
                <div className="flex flex-wrap gap-1.5">
                  {p.items.map((it, j) => {
                    if (isBar(it)) bar++;
                    const n = bar;
                    return (
                      <Chip
                        key={j}
                        it={it}
                        selected={!locked && sel?.pid === p.id && sel.at === j}
                        changed={isBar(it) && diff.has(n)}
                        onTap={() => !locked && select({ pid: p.id, at: j, replace: isBar(it) })}
                        onHold={!locked && isBar(it) ? () => setSheet({ kind: "bar", pid: p.id, at: j }) : undefined}
                      />
                    );
                  })}
                  {!locked && (
                    <button
                      type="button"
                      onClick={() => select({ pid: p.id, at: p.items.length - 1, replace: false })}
                      className={`flex h-14 min-w-16 items-center justify-center border border-dashed px-3 text-lg ${
                        sel?.pid === p.id && sel.at === p.items.length - 1 && !sel.replace ? "border-bb-downbeat-amber text-bb-chart-white" : "border-bb-rule-gray text-bb-cue-gray"
                      }`}
                    >
                      {p.items.length ? "+ bars" : "Tap to add bars"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {!locked && (
            <button type="button" onClick={() => setSheet({ kind: "add" })} className="bb-btn bb-btn-secondary h-14 w-full text-xl font-semibold">
              + Add section
            </button>
          )}
          {!locked && (
            <div className="mt-4 flex flex-col gap-2 border-t border-bb-rule-gray pt-4">
              <button type="button" disabled={busy || offline || !made.parts.length} onClick={() => setSheet({ kind: "submit" })} className="bb-btn bb-btn-secondary h-12 w-full text-lg font-semibold">
                Send to library
              </button>
              <button type="button" disabled={busy || offline} onClick={() => setSheet({ kind: "delete" })} className="bb-btn bb-btn-danger h-12 w-full text-lg font-semibold">
                Delete chart
              </button>
              {offline && <p className="text-base text-bb-cue-gray">{OFFLINE_MSG}</p>}
            </div>
          )}
        </section>

        <section aria-label="Preview" className="mt-8 lg:sticky lg:top-4 lg:mt-0 lg:self-start">
          <h2 className="mb-2 text-2xl font-bold">Preview</h2>
          {s.view ? (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <DisplayControls s={s} />
              </div>
              <KeyInfo s={s} />
              <div className="mt-3">
                <Chart view={s.view} chords={s.chords} fontFamily={FONTS[s.font].css} fontWeight={FONTS[s.font].weight} style={{ fontSize: "clamp(1.4rem, 6vw, 2.2rem)" }} />
              </div>
              {!made.parts.length && <p className="text-lg text-bb-cue-gray">Add a section to start.</p>}
            </>
          ) : (
            <p className="bb-error px-3 py-2 text-lg">{s.error}</p>
          )}
        </section>
      </div>

      {sel && part && !locked && !sheet && <Pad s={pad} onKey={onKey} where={where} onDone={() => select(null)} />}

      {sheet?.kind === "add" && (
        <AddSection
          made={made}
          onClose={() => setSheet(null)}
          onAdd={(label) => {
            const r = addPart(made, label);
            setMade(r.made);
            select({ pid: r.id, at: -1, replace: false });
            setSheet(null);
          }}
          onDuplicate={(pid) => {
            const r = duplicatePart(made, pid);
            setMade(r.made);
            const first = r.made.parts.find((p) => p.id === r.id)!.items.findIndex(isBar);
            select({ pid: r.id, at: first, replace: first >= 0 });
            setSheet(null);
          }}
        />
      )}

      {sheet?.kind === "header" && (
        <Sheet title="Song info" onClose={() => setSheet(null)}>
          <HeaderFields
            value={made.header}
            onChange={(v) => setMade((m) => ({ ...m, header: { ...m.header, ...v, bpm: v.bpm } }))}
          />
          {headerError(made.header) && <p className="bb-error mt-3 px-3 py-2 text-lg">{headerError(made.header)}</p>}
          <button
            type="button"
            className="bb-btn bb-btn-primary mt-4 h-12 w-full text-lg font-bold"
            disabled={!!headerError(made.header)}
            onClick={() => {
              setMade((m) => ({ ...m, header: { ...m.header, bpm: cleanBpm(m.header.bpm) } }));
              setSheet(null);
            }}
          >
            Done
          </button>
        </Sheet>
      )}

      {sheet?.kind === "section" &&
        (() => {
          const p = made.parts.find((x) => x.id === sheet.pid);
          if (!p) return null;
          return (
            <SectionMenu
              part={p}
              made={made}
              onClose={() => setSheet(null)}
              onRename={(label) => setMade((m) => renamePart(m, p.id, label))}
              onRepeat={(n) => setMade((m) => setRepeat(m, p.id, n))}
              onNote={() => setSheet({ kind: "note", pid: p.id, at: 0 })}
              onDuplicate={() => {
                const r = duplicatePart(made, p.id);
                setMade(r.made);
                const first = r.made.parts.find((x) => x.id === r.id)!.items.findIndex(isBar);
                select({ pid: r.id, at: first, replace: first >= 0 });
                setSheet(null);
              }}
              onDelete={() => deletePart(p)}
            />
          );
        })()}

      {sheet?.kind === "bar" &&
        (() => {
          const p = made.parts.find((x) => x.id === sheet.pid);
          const it = p?.items[sheet.at];
          if (!p || !it) return null;
          const set = (next: RowItem[], at: number) => {
            setMade((m) => setItems(m, p.id, next));
            select({ pid: p.id, at, replace: false });
            setSheet(null);
          };
          return (
            <Sheet title={`Bar ${p.items.slice(0, sheet.at + 1).filter(isBar).length} of ${partName(p.label)}`} onClose={() => setSheet(null)}>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  className={sheetBtn}
                  onClick={() => {
                    setClip(structuredClone(it));
                    setSheet(null);
                  }}
                >
                  Copy
                </button>
                <button type="button" className={sheetBtn} disabled={!clip} onClick={() => clip && set(insertItems(p.items, sheet.at + 1, [clip]), sheet.at + 1)}>
                  Paste after this bar
                </button>
                <button type="button" className={sheetBtn} onClick={() => setSheet({ kind: "note", pid: p.id, at: sheet.at })}>
                  Add a note before this bar
                </button>
                <button
                  type="button"
                  className="bb-btn bb-btn-danger h-12 px-4 text-lg font-semibold"
                  onClick={() =>
                    set(
                      p.items.filter((_, i) => i !== sheet.at),
                      sheet.at - 1,
                    )
                  }
                >
                  Delete this bar
                </button>
              </div>
            </Sheet>
          );
        })()}

      {sheet?.kind === "note" && (
        <NoteSheet
          endRepeat={(() => {
            const p = made.parts.find((x) => x.id === sheet.pid);
            const prev = p?.items[sheet.at - 1];
            return prev?.kind === "repeatSign" && prev.side === "end" ? prev : null;
          })()}
          onClose={() => setSheet(null)}
          onInsert={(add) => {
            const p = made.parts.find((x) => x.id === sheet.pid);
            if (!p) return setSheet(null);
            setMade((m) => setItems(m, p.id, insertItems(p.items, sheet.at, add)));
            select({ pid: p.id, at: sheet.at + add.length - 1, replace: false });
            setSheet(null);
          }}
          onRepeatOut={(on) => {
            const p = made.parts.find((x) => x.id === sheet.pid);
            if (!p) return setSheet(null);
            const at = sheet.at - 1;
            setMade((m) => setItems(m, p.id, replaceAt(p.items, at, { kind: "repeatSign", side: "end", text: on ? "repeat out" : "" })));
            setSheet(null);
          }}
        />
      )}

      {sheet?.kind === "more" && (
        <Sheet title="More" onClose={() => setSheet(null)}>
          <p className="mb-2 text-base text-bb-cue-gray">Chord type for the selected bar</p>
          <div className="grid grid-cols-4 gap-1.5">
            {MORE_QUALITIES.map((m) => (
              <button
                key={m.label}
                type="button"
                disabled={beat?.kind !== "chord"}
                className={`bb-btn h-12 px-1 text-lg font-semibold ${beat?.kind === "chord" && beat.quality === m.q ? "bb-on" : "bb-btn-secondary"}`}
                onClick={() => {
                  onBeat((x) => (x.kind === "chord" ? { ...x, quality: m.q } : x));
                  setSheet(null);
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="mb-2 mt-4 text-base text-bb-cue-gray">Other bars</p>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              className={sheetBtn}
              onClick={() => {
                const nc: BeatItem = { kind: "nc", push: false, diamond: false, end: "" };
                if (sel?.replace && curBar && sel) edit(replaceAt(items, sel.at, nc), sel.at);
                else if (sel) edit(insertItems(items, sel.at + 1, [nc]), sel.at + 1);
                setSheet(null);
              }}
            >
              N.C. (no chord)
            </button>
            <button
              type="button"
              className={sheetBtn}
              onClick={() => {
                if (sel) edit(insertItems(items, sel.at + 1, [{ kind: "repeat" }]), sel.at + 1);
                setSheet(null);
              }}
            >
              % (same bar again)
            </button>
            <button
              type="button"
              disabled={!beat || beat.kind === "repeat"}
              className={sheetBtn}
              onClick={() => {
                onBeat((x) => (x.kind === "repeat" ? x : { ...x, end: x.end === "fermata" ? "" : "fermata" }));
                setSheet(null);
              }}
            >
              Fermata (hold till cued)
            </button>
          </div>
        </Sheet>
      )}

      {sheet?.kind === "submit" && (
        <SubmitSheet
          busy={busy}
          saved={!dirty}
          offline={offline}
          onClose={() => setSheet(null)}
          onSubmit={(note) =>
            run(
              async () => {
                const r = await submitChart(id, note);
                if (r.ok) setProposalId(r.proposal);
                return r;
              },
              () => {
                setLocked(true);
                select(null);
                setSheet(null);
                router.refresh();
              },
            )
          }
        />
      )}

      {sheet?.kind === "delete" && (
        <Sheet title="Delete chart?" onClose={() => setSheet(null)}>
          <p className="mb-4 text-lg">“{made.header.title}” goes for good, from your setlists too. This can&apos;t be undone.</p>
          <button
            type="button"
            disabled={busy || offline}
            className="bb-btn bb-btn-danger h-12 w-full text-lg font-semibold"
            onClick={() =>
              run(
                () => deleteChart(id),
                () => {
                  setSavedText(text);
                  router.push("/");
                },
              )
            }
          >
            Delete for good
          </button>
        </Sheet>
      )}
    </main>
  );
}

function AddSection({ made, onClose, onAdd, onDuplicate }: { made: Made; onClose: () => void; onAdd: (l: SectionLabel) => void; onDuplicate: (pid: string) => void }) {
  const [name, setName] = useState("");
  const bad = name ? customNameError(name) : null;
  return (
    <Sheet title="Add section" onClose={onClose}>
      <div className="grid grid-cols-2 gap-1.5">
        {SECTION_TYPES.map((t) => (
          <button key={t.name} type="button" className={sheetBtn} onClick={() => onAdd(makeLabel(made.parts, t.name, false))}>
            {t.label}
          </button>
        ))}
      </div>
      <form
        className="mt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name && !bad) onAdd(makeLabel(made.parts, name, true));
        }}
      >
        <label htmlFor="mk-custom" className="mb-1 block text-lg font-semibold">
          Custom name
        </label>
        <div className="flex gap-2">
          <input id="mk-custom" className="bb-input h-12 min-w-0 flex-1 px-3 text-lg" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} placeholder="Breakdown, Big ending…" autoComplete="off" />
          <button type="submit" disabled={!name || !!bad} className={sheetBtn}>
            Add
          </button>
        </div>
        {bad && <p className="mt-1 text-base text-bb-stop-red">{bad}</p>}
      </form>
      {made.parts.length > 0 && (
        <>
          <h3 className="mb-1 mt-5 text-lg font-semibold">Duplicate a section</h3>
          <p className="mb-2 text-base text-bb-cue-gray">A full copy goes right after it, ready to change.</p>
          <div className="flex flex-col gap-1.5">
            {made.parts.map((p) => (
              <button key={p.id} type="button" className={`${sheetBtn} justify-between`} onClick={() => onDuplicate(p.id)}>
                <span>{partName(p.label)}</span>
                <span className="text-base font-normal text-bb-cue-gray">{p.items.filter(isBar).length} bars</span>
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}

function SectionMenu({
  part,
  made,
  onClose,
  onRename,
  onRepeat,
  onNote,
  onDuplicate,
  onDelete,
}: {
  part: Part;
  made: Made;
  onClose: () => void;
  onRename: (l: SectionLabel) => void;
  onRepeat: (n: number) => void;
  onNote: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [custom, setCustom] = useState(part.label.custom ? part.label.name : "");
  const bad = custom ? customNameError(custom) : null;
  const others = made.parts.filter((p) => p.id !== part.id);
  const rename = (name: string, isCustom: boolean) => {
    const n = isCustom ? name.replace(/\s+/g, " ").trim() : name;
    const same = n === part.label.name && isCustom === part.label.custom;
    onRename(same ? part.label : { ...makeLabel(others, n, isCustom), repeat: part.label.repeat });
  };
  const times = part.label.repeat ?? 1;
  return (
    <Sheet title={partName(part.label)} onClose={onClose}>
      <h3 className="mb-1 text-lg font-semibold">Play it</h3>
      <div className="mb-4 flex items-center gap-2">
        <button type="button" className="bb-btn bb-btn-secondary h-12 w-12 text-xl" aria-label="Fewer times" disabled={times <= 1} onClick={() => onRepeat(times - 1)}>
          −
        </button>
        <span className="w-12 text-center text-xl font-bold">×{times}</span>
        <button type="button" className="bb-btn bb-btn-secondary h-12 w-12 text-xl" aria-label="More times" disabled={times >= 9} onClick={() => onRepeat(times + 1)}>
          +
        </button>
      </div>
      <h3 className="mb-1 text-lg font-semibold">Rename</h3>
      <div className="grid grid-cols-3 gap-1.5">
        {SECTION_TYPES.map((t) => (
          <button
            key={t.name}
            type="button"
            className={`bb-btn h-12 px-1 text-base font-semibold ${!part.label.custom && part.label.name === t.name ? "bb-on" : "bb-btn-secondary"}`}
            onClick={() => rename(t.name, false)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (custom && !bad) rename(custom, true);
        }}
      >
        <input aria-label="Custom name" className="bb-input h-12 min-w-0 flex-1 px-3 text-lg" value={custom} maxLength={30} onChange={(e) => setCustom(e.target.value)} placeholder="Custom name" autoComplete="off" />
        <button type="submit" disabled={!custom || !!bad} className={sheetBtn}>
          Rename
        </button>
      </form>
      {bad && <p className="mt-1 text-base text-bb-stop-red">{bad}</p>}
      <div className="mt-5 flex flex-col gap-1.5">
        <button type="button" className={sheetBtn} onClick={onNote}>
          Add a note to this section
        </button>
        <button type="button" className={sheetBtn} onClick={onDuplicate}>
          Duplicate
        </button>
        <button type="button" className="bb-btn bb-btn-danger h-12 px-4 text-lg font-semibold" onClick={onDelete}>
          Delete section
        </button>
      </div>
    </Sheet>
  );
}

function NoteSheet({
  endRepeat,
  onClose,
  onInsert,
  onRepeatOut,
}: {
  endRepeat: Extract<RowItem, { kind: "repeatSign" }> | null;
  onClose: () => void;
  onInsert: (items: RowItem[]) => void;
  onRepeatOut: (on: boolean) => void;
}) {
  const [text, setText] = useState("");
  const bad = text ? noteError(text) : null;
  return (
    <Sheet title="Note or key change" onClose={onClose}>
      {endRepeat && (
        <button type="button" className={`${sheetBtn} mb-4 w-full ${endRepeat.text ? "bb-on" : ""}`} aria-pressed={!!endRepeat.text} onClick={() => onRepeatOut(!endRepeat.text)}>
          {endRepeat.text ? "✓ “repeat out” on this :|" : "Add “repeat out” to this :|"}
        </button>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text && !bad) onInsert([{ kind: "box", text: cleanNote(text) }]);
        }}
      >
        <label htmlFor="mk-note" className="mb-1 block text-lg font-semibold">
          Boxed note
        </label>
        <div className="flex gap-2">
          <input id="mk-note" className="bb-input h-12 min-w-0 flex-1 px-3 text-lg" value={text} maxLength={60} onChange={(e) => setText(e.target.value)} placeholder="Band in, Big hit…" autoComplete="off" />
          <button type="submit" disabled={!text || !!bad} className={sheetBtn}>
            Add
          </button>
        </div>
        <p className={`mt-1 text-base ${bad ? "text-bb-stop-red" : "text-bb-cue-gray"}`}>{bad ?? "6 words or fewer. Cues only, never lyrics."}</p>
      </form>
      <h3 className="mb-1 mt-5 text-lg font-semibold">Key change</h3>
      <p className="mb-2 text-base text-bb-cue-gray">The numbers after it stay as you write them, counted in the new key.</p>
      <div className="grid grid-cols-2 gap-1.5">
        {KEY_CHANGES.map((k) => (
          <button key={k.semis} type="button" className={sheetBtn} onClick={() => onInsert(keyChangeItems(k.semis))}>
            {k.label}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function SubmitSheet({ busy, saved, offline, onClose, onSubmit }: { busy: boolean; saved: boolean; offline: boolean; onClose: () => void; onSubmit: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <Sheet title="Send to library" onClose={onClose}>
      <p className="mb-3 text-lg">
        Other players vote on it in Community. Once enough approve it, it joins the library for everyone. While it waits you can&apos;t change it; withdraw it any time to edit.
      </p>
      <label htmlFor="mk-sub-note" className="mb-1 block text-lg font-semibold">
        Note for voters <span className="font-normal text-bb-cue-gray">(optional)</span>
      </label>
      <input id="mk-sub-note" className="bb-input h-12 w-full px-3 text-lg" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="New song for the library" autoComplete="off" />
      {!saved && !offline && <p className="mt-2 text-base text-bb-cue-gray">Saving your last change first…</p>}
      {offline && <p className="mt-2 text-base text-bb-cue-gray">{OFFLINE_MSG}</p>}
      <button type="button" disabled={busy || !saved || offline} className="bb-btn bb-btn-primary mt-4 h-12 w-full text-lg font-bold" onClick={() => onSubmit(note)}>
        {busy ? "Sending…" : "Send to library"}
      </button>
    </Sheet>
  );
}
