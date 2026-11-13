"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { buildView, checkChart } from "@/lib/chart";
import { FLAG_REASONS, unclearMarks } from "@/lib/review/unclear";
import { cleanSkip, prefsQuery, type Prefs } from "@/lib/review/queue";
import { modLabel, reviewKey, SHORTCUTS, type ReviewKey } from "@/lib/review/keys";
import Chart from "@/app/songs/[slug]/Chart";
import { FONTS } from "@/app/songs/[slug]/hooks";
import PdfViewer from "../PdfViewer";
import {
  cantRead,
  claimReview,
  discardDraft,
  dismissFlags,
  markDuplicate,
  nextReview,
  publishReview,
  releaseReview,
  saveDraft,
  setHold,
  type Claim,
} from "../actions";

export interface ReviewSong {
  id: string;
  slug: string;
  title: string;
  artist: string | null;
  status: string;
  unverified: boolean;
  review_hold: boolean;
  revision_id: string | null;
  chart_text: string | null;
  source: string | null;
  confidence: number | null;
  notes: string | null;
  import_file_id: string | null;
  file_status: string | null;
  file_name: string | null;
  is_admin: boolean;
  draft: { chart_text: string; base_revision_id: string | null; updated_at: string; by: string } | null;
  flags: { reason: keyof typeof FLAG_REASONS; details: string | null; created_at: string; by: string | null }[];
  duplicates: { id: string; title: string; artist: string | null; status: string; file_name: string | null }[];
}

const SKIP_KEY = "bb_review_skip"; // songs skipped this sitting
const TAB_KEY = "bb_review_tab";
const RENEW_MS = 4 * 60_000; // renew the 30-minute claim at most this often, while working
const btn = "min-h-12 rounded-xl px-4 text-lg font-semibold disabled:opacity-40";

const template = (s: ReviewSong) => `{title: ${s.title}}\n{artist: ${s.artist ?? ""}}\n\n[V]\n`;

function readSkip(): string[] {
  try {
    return cleanSkip(JSON.parse(sessionStorage.getItem(SKIP_KEY) ?? "[]"));
  } catch {
    return [];
  }
}
function addSkip(id: string) {
  try {
    sessionStorage.setItem(SKIP_KEY, JSON.stringify(cleanSkip([...readSkip(), id])));
  } catch {
    /* private mode */
  }
}

export default function ReviewEditor({ song, prefs }: { song: ReviewSong; prefs: Prefs }) {
  const router = useRouter();
  const area = useRef<HTMLTextAreaElement>(null);
  const back = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const start0 = song.draft?.chart_text ?? song.chart_text ?? template(song);
  const [text, setText] = useState(start0);
  const [saved, setSaved] = useState(start0);
  const [draft, setDraft] = useState(song.draft);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [claim, setClaim] = useState<Claim | null>(null);
  const [claimErr, setClaimErr] = useState<string | null>(null);
  const [minutesLeft, setMinutesLeft] = useState<number | null>(null);
  const [tab, setTab] = useState<"chart" | "original">("chart");
  const [active, setActive] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [apple, setApple] = useState(true);
  const lastActivity = useRef(0);
  const lastRenew = useRef(0);

  const check = useMemo(() => checkChart(text), [text]);
  const view = useMemo(() => (check.doc ? buildView(check.doc) : null), [check.doc]);
  const marks = useMemo(() => unclearMarks(text, check.doc ?? null), [text, check.doc]);
  const markedRows = useMemo(() => new Set(marks.flatMap((m) => m.rows)), [marks]);
  const noteLines = useMemo(() => new Set(marks.map((m) => m.note.line)), [marks]);
  const targetLines = useMemo(() => new Set(marks.flatMap((m) => (m.target == null ? [] : [m.target]))), [marks]);
  const lines = useMemo(() => text.split("\n"), [text]);
  const formatOk = !check.error && check.longCues.length === 0;
  const mine = claim?.mine === true;
  const dirty = text !== saved;
  const q = prefsQuery(prefs);
  const live = song.status === "published";

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of browser-only state
    setApple(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
    try {
      const t = sessionStorage.getItem(TAB_KEY);
      if (t === "original" || t === "chart") setTab(t);
    } catch {
      /* private mode */
    }
  }, []);
  const pickTab = (t: "chart" | "original") => {
    setTab(t);
    try {
      sessionStorage.setItem(TAB_KEY, t);
    } catch {
      /* private mode */
    }
  };

  // ── claim: on open, renewed while working, released on leaving ──
  useEffect(() => {
    let alive = true;
    claimReview(song.id).then((r) => {
      if (!alive) return;
      lastRenew.current = Date.now();
      if (r.ok) {
        setClaim(r.claim);
        if (r.claim.expires_at) setMinutesLeft(Math.max(1, Math.ceil((Date.parse(r.claim.expires_at) - Date.now()) / 60_000)));
      } else setClaimErr(r.error);
    });
    const release = () => navigator.sendBeacon("/admin/review/release", JSON.stringify({ id: song.id }));
    window.addEventListener("pagehide", release);
    return () => {
      alive = false;
      window.removeEventListener("pagehide", release);
      release();
    };
  }, [song.id]);

  useEffect(() => {
    if (!mine) return;
    const onActivity = () => (lastActivity.current = Date.now());
    window.addEventListener("keydown", onActivity);
    window.addEventListener("pointerdown", onActivity);
    window.addEventListener("wheel", onActivity, { passive: true });
    const t = setInterval(async () => {
      if (lastActivity.current <= lastRenew.current || Date.now() - lastRenew.current < RENEW_MS) return;
      lastRenew.current = Date.now();
      const r = await claimReview(song.id);
      if (r.ok) setClaim(r.claim);
    }, 30_000);
    return () => {
      clearInterval(t);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("wheel", onActivity);
    };
  }, [mine, song.id]);

  // Unsaved edits: ask before closing the tab.
  useEffect(() => {
    if (!dirty || !mine) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, mine]);

  // ── actions ──
  const goNext = useCallback(async () => {
    const r = await nextReview(prefs.filter, prefs.order, [...readSkip(), song.id]);
    router.push(r.ok && r.id ? `/admin/review/${r.id}?${q}` : `/admin/review?${q}`);
  }, [prefs.filter, prefs.order, song.id, router, q]);

  const run = useCallback(
    (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string, advance: boolean) =>
      start(async () => {
        const r = await fn();
        if (!r.ok) return setMsg({ ok: false, text: r.error });
        setMsg({ ok: true, text: done });
        if (advance) {
          setSaved(text); // nothing left to warn about
          await goNext();
        } else router.refresh();
      }),
    [goNext, router, text],
  );

  const act = useCallback(
    (a: ReviewKey) => {
      if (pending || !mine) return;
      if (a === "publish") {
        if (!formatOk) return setMsg({ ok: false, text: "Fix the format error first." });
        if (marks.length) return setMsg({ ok: false, text: "Fix or delete every unclear note first (or publish unverified)." });
        run(() => publishReview(song.id, text, true, song.revision_id), "Published as verified.", true);
      } else if (a === "unverified") {
        if (!formatOk) return setMsg({ ok: false, text: "Fix the format error first." });
        run(() => publishReview(song.id, text, false, song.revision_id), "Published as unverified.", true);
      } else if (a === "save") {
        start(async () => {
          const r = await saveDraft(song.id, text, song.revision_id);
          if (!r.ok) return setMsg({ ok: false, text: r.error });
          setSaved(text);
          setDraft({ chart_text: text, base_revision_id: song.revision_id, updated_at: r.at, by: "you" });
          setMsg({ ok: true, text: "Draft saved." });
        });
      } else if (a === "cant_read") {
        if (live) return setMsg({ ok: false, text: "This chart is live; “Can't read” is only for charts not live yet." });
        run(() => cantRead(song.id), "Moved to Can't read.", true);
      } else if (a === "skip") {
        addSkip(song.id);
        start(async () => {
          await releaseReview(song.id);
          setSaved(text);
          await goNext();
        });
      }
    },
    [pending, mine, formatOk, marks.length, run, song.id, song.revision_id, text, live, goNext],
  );

  // Shortcuts work while typing; "?" (outside the editor) shows the list.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = reviewKey(e);
      if (a) {
        e.preventDefault();
        act(a);
        return;
      }
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.tagName === "SELECT");
      if (e.key === "?" && !typing) setHelp((h) => !h);
      if (e.key === "Escape") setHelp(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act]);

  // ── editor ⇄ preview ──
  const syncBack = () => {
    if (back.current && area.current) {
      back.current.scrollTop = area.current.scrollTop;
      back.current.scrollLeft = area.current.scrollLeft;
    }
  };
  const showRow = (id: string | null) => {
    setActive(id);
    const box = preview.current;
    const row = id ? box?.querySelector<HTMLElement>(`[data-row="${id}"]`) : null;
    if (!box || !row) return;
    const top = row.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 24;
    box.scrollTo({ top, behavior: "smooth" });
  };
  const jump = (startAt: number, end: number) => {
    const el = area.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(startAt, end);
    const line = text.slice(0, startAt).split("\n").length - 1;
    el.scrollTop = Math.max(0, line * 28 - el.clientHeight / 3);
    syncBack();
  };
  const caretLine = () => {
    const el = area.current;
    return el ? text.slice(0, el.selectionStart).split("\n").length - 1 : -1;
  };
  const onCaret = (scroll: boolean) => {
    const line = caretLine();
    const m = marks.find((x) => x.note.line === line || x.target === line);
    const id = m?.rows[0] ?? null;
    if (scroll && id) showRow(id);
    else setActive(id);
  };
  const onRowTap = (id: string) => {
    const m = marks.find((x) => x.rows.includes(id));
    setActive(id);
    if (m) {
      pickTab("chart");
      jump(m.note.start, m.note.end);
    }
  };

  const resetToAi = () =>
    start(async () => {
      if (draft) {
        const r = await discardDraft(song.id);
        if (!r.ok) return setMsg({ ok: false, text: r.error });
      }
      const t = song.chart_text ?? template(song);
      setText(t);
      setSaved(t);
      setDraft(null);
      setMsg({ ok: true, text: song.chart_text ? "Back to the AI reading." : "Draft discarded." });
    });

  const sc = (a: ReviewKey) => modLabel(SHORTCUTS.find((s) => s.action === a)!.keys, apple);

  return (
    <>
      <h1 className="text-3xl font-bold leading-tight">
        {song.title} <span className="text-muted">· {song.artist ?? "no artist"}</span>
      </h1>
      <p className="mb-3 text-lg text-muted">
        {live ? (song.unverified ? "Live, unverified" : "Live, verified") : song.file_status === "needs_manual" ? "Can't read: type it in" : "Not live yet"}
        {song.confidence != null && ` · reader confidence ${Number(song.confidence).toFixed(2)}`}
        {song.review_hold && " · on hold"}
        {song.notes && ` · “${song.notes}”`}
      </p>

      {claimErr && <p className="mb-3 rounded-xl border border-red-500/60 bg-red-500/10 p-3 text-lg">{claimErr}</p>}
      {claim && !mine && (
        <section className="mb-3 rounded-xl border border-amber-400/70 bg-amber-400/10 p-4" aria-label="Claimed">
          <p className="mb-2 text-xl font-semibold">
            Being reviewed by {claim.by}
            {minutesLeft && <span className="font-normal text-muted"> · up to {minutesLeft} min left</span>}
          </p>
          <p className="mb-3 text-lg text-muted">You can look, but not change it, until they finish or their claim runs out.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`${btn} bg-accent text-black`} disabled={pending} onClick={() => start(goNext)}>
              Next song ›
            </button>
            <button type="button" className={`${btn} border border-line`} onClick={() => window.location.reload()}>
              Check again
            </button>
          </div>
        </section>
      )}
      {!claim && !claimErr && <p className="mb-3 text-lg text-muted">Claiming this song…</p>}

      {song.flags.length > 0 && (
        <section className="mb-3 rounded-xl border border-red-500/60 bg-red-500/10 p-4" aria-label="Player flags">
          <h2 className="mb-2 text-xl font-semibold">Flagged by {song.flags.length} player{song.flags.length === 1 ? "" : "s"}</h2>
          <ul className="mb-2 flex flex-col gap-1 text-lg">
            {song.flags.map((f, i) => (
              <li key={i}>
                <b>{FLAG_REASONS[f.reason] ?? f.reason}</b>
                {f.details && <> · “{f.details}”</>}
                {f.by && <span className="text-muted"> · {f.by}</span>}
              </li>
            ))}
          </ul>
          {song.is_admin && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => dismissFlags(song.id), "Flags dismissed.", false)}
              className={`${btn} border border-line`}
            >
              Dismiss flags (chart is right)
            </button>
          )}
        </section>
      )}

      {song.duplicates.length > 0 && (
        <section className="mb-3 rounded-xl border border-sky-400/60 bg-sky-400/10 p-4" aria-label="Duplicates">
          <h2 className="mb-1 text-xl font-semibold">Another PDF has the same title and artist</h2>
          <ul className="mb-2 flex flex-col gap-1 text-lg">
            {song.duplicates.map((d) => (
              <li key={d.id}>
                <Link href={`/admin/review/${d.id}?${q}`} className="text-accent">
                  {d.file_name ?? d.title}
                </Link>{" "}
                <span className="text-muted">· {d.status === "published" ? "live" : d.status === "imported" ? "not read yet" : "in review"}</span>
              </li>
            ))}
          </ul>
          {song.is_admin && mine && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`Hide this copy (${song.file_name ?? song.title}) for good? The other copy stays.`))
                  run(() => markDuplicate(song.id), "Hidden as a duplicate.", true);
              }}
              className={`${btn} border border-sky-400/60`}
            >
              Not needed (duplicate)
            </button>
          )}
        </section>
      )}

      {/* Phone: one pane at a time */}
      <div className="sticky top-0 z-10 -mx-4 mb-3 grid grid-cols-2 gap-2 bg-background px-4 py-2 lg:hidden" role="tablist">
        {(["original", "chart"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => pickTab(t)}
            className={`min-h-12 rounded-xl text-lg font-semibold ${tab === t ? "bg-accent text-black" : "border border-line"}`}
          >
            {t === "original" ? "Original" : `Chart${marks.length ? ` · ${marks.length} unclear` : ""}`}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className={`${tab === "original" ? "" : "hidden"} h-[calc(100dvh-13rem)] lg:sticky lg:top-2 lg:block lg:h-[calc(100dvh-1rem)] lg:self-start`}>
          {song.import_file_id ? (
            <PdfViewer src={`/admin/import/pdf/${song.import_file_id}?inline=1`} title={song.title} />
          ) : (
            <p className="text-lg text-muted">No original PDF linked to this song.</p>
          )}
        </div>

        <div className={`${tab === "chart" ? "" : "hidden"} min-w-0 pb-36 lg:block lg:pb-0`}>
          {draft && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel p-3 text-lg">
              <span>
                Draft saved by {draft.by} · {new Date(draft.updated_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                {draft.base_revision_id !== song.revision_id && (
                  <b className="block text-amber-200">The chart changed after this draft was saved. Check it against the original.</b>
                )}
              </span>
              {mine && (
                <button type="button" disabled={pending} onClick={resetToAi} className="ml-auto min-h-11 rounded-lg border border-line px-3">
                  {song.chart_text ? "Reset to AI reading" : "Discard draft"}
                </button>
              )}
            </div>
          )}

          {marks.length > 0 ? (
            <section className="mb-3" aria-label="Unclear spots">
              <h2 className="mb-1 text-xl font-semibold">
                {marks.length} unclear spot{marks.length === 1 ? "" : "s"}{" "}
                <span className="text-base font-normal text-muted">· tap to find it, fix the bar, delete the note</span>
              </h2>
              <ul className="flex flex-col gap-1">
                {marks.map((m) => (
                  <li key={m.note.start}>
                    <button
                      type="button"
                      onClick={() => {
                        jump(m.note.start, m.note.end);
                        showRow(m.rows[0] ?? null);
                      }}
                      className={`min-h-11 w-full rounded-lg px-3 py-2 text-left text-base text-amber-100 active:bg-amber-400/30 ${
                        active && m.rows.includes(active) ? "bg-amber-400/30" : "bg-amber-400/15"
                      }`}
                    >
                      {m.note.where && <b>{m.note.where}: </b>}
                      {m.note.saw}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <p className="mb-3 rounded-lg bg-green-500/15 px-3 py-2 text-lg text-green-100">No unclear notes left.</p>
          )}

          <label htmlFor="chart" className="sr-only">Chart text</label>
          <div className="relative overflow-hidden rounded-lg border border-line bg-background">
            <div ref={back} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden p-3 font-mono text-lg leading-7 text-transparent">
              <div className="w-max min-w-full whitespace-pre">
                {lines.map((l, i) => (
                  <div key={i} className={noteLines.has(i) ? "bg-amber-400/30" : targetLines.has(i) ? "bg-amber-400/15" : undefined}>
                    {l || "​"}
                  </div>
                ))}
              </div>
            </div>
            <textarea
              id="chart"
              ref={area}
              value={text}
              readOnly={!mine}
              wrap="off"
              onChange={(e) => setText(e.target.value)}
              onScroll={syncBack}
              onClick={() => onCaret(true)}
              onKeyUp={() => onCaret(false)}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              rows={16}
              className="relative block w-full resize-y bg-transparent p-3 font-mono text-lg leading-7 outline-none read-only:opacity-70"
            />
          </div>
          {check.error && <p className="mt-1 text-lg text-red-300">Format error: {check.error}</p>}
          {check.longCues.length > 0 && <p className="mt-1 text-lg text-red-300">Cue over 6 words (no lyrics): “{check.longCues[0]}”</p>}

          {/* Actions: pinned to the bottom on phones */}
          {mine && (
            <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-background/95 p-2 backdrop-blur lg:static lg:mt-4 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
              <div className="mx-auto grid max-w-2xl grid-cols-3 gap-2 lg:flex lg:max-w-none lg:flex-wrap">
                <button
                  type="button"
                  disabled={pending || !formatOk || marks.length > 0}
                  title={marks.length ? "Fix or delete every unclear note first" : sc("publish")}
                  onClick={() => act("publish")}
                  className={`${btn} col-span-2 bg-accent text-black`}
                >
                  Publish
                </button>
                <button type="button" disabled={pending || !formatOk} title={sc("unverified")} onClick={() => act("unverified")} className={`${btn} border border-line`}>
                  Unverified
                </button>
                <button type="button" disabled={pending || !dirty} title={sc("save")} onClick={() => act("save")} className={`${btn} border border-line`}>
                  {dirty ? "Save draft" : "Saved"}
                </button>
                {!live && (
                  <button type="button" disabled={pending} title={sc("cant_read")} onClick={() => act("cant_read")} className={`${btn} border border-line`}>
                    Can&apos;t read
                  </button>
                )}
                <button type="button" disabled={pending} title={sc("skip")} onClick={() => act("skip")} className={`${btn} border border-line`}>
                  Skip ›
                </button>
              </div>
            </div>
          )}
          <p role="status" aria-live="polite" className={`mb-2 mt-2 min-h-7 text-lg ${msg?.ok ? "text-muted" : "text-red-300"}`}>
            {pending ? "Working…" : msg?.text}
          </p>

          <div className="mb-4 flex flex-wrap gap-2">
            {mine && song.is_admin && song.status === "needs_review" && (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => setHold(song.id, !song.review_hold), song.review_hold ? "Back in the queue." : "On hold.", !song.review_hold)}
                className="min-h-11 rounded-lg border border-line px-3 text-lg"
              >
                {song.review_hold ? "Take off hold" : "Hold (back of the queue for everyone)"}
              </button>
            )}
            <button type="button" onClick={() => setHelp((h) => !h)} className="hidden min-h-11 rounded-lg border border-line px-3 text-lg lg:inline-block">
              Shortcuts (?)
            </button>
          </div>
          {help && (
            <section className="mb-4 rounded-xl border border-line bg-panel p-4" aria-label="Keyboard shortcuts">
              <h2 className="mb-2 text-xl font-semibold">Keyboard shortcuts</h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-lg">
                {SHORTCUTS.map((s) => (
                  <div key={s.action} className="contents">
                    <dt className="font-mono font-semibold">{modLabel(s.keys, apple)}</dt>
                    <dd>{s.label}</dd>
                  </div>
                ))}
                <dt className="font-mono font-semibold">?</dt>
                <dd>Show or hide this list</dd>
              </dl>
            </section>
          )}

          <h2 className="mb-2 text-xl font-semibold">Preview</h2>
          <div ref={preview} className="max-h-[60vh] overflow-auto rounded-lg border border-line p-3">
            {view ? (
              <Chart
                view={view}
                chords={false}
                fontFamily={FONTS.atkinson.css}
                fontWeight={FONTS.atkinson.weight}
                style={{ fontSize: "1.6rem" }}
                marks={{ rows: markedRows, active, onTap: onRowTap }}
              />
            ) : (
              <p className="text-muted">Fix the format error to see the preview.</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
