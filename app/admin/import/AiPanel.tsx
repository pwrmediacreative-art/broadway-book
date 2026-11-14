"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { approvePilot, batchStep, confirmFirstChunk, retryFailed, runPilot, type AiState } from "./ai-actions";

export interface AiSummary {
  configured: boolean; // ANTHROPIC_API_KEY + MAX_AI_SPEND_USD + Dropbox
  cap: number;
  spent: number;
  reserved: number;
  done: number;
  needsManual: number;
  failed: number;
  processing: number;
  remaining: number;
  unnamed: number;
  openBatches: number;
  pilotCount: number;
  pilotApproved: boolean;
  estPerSong: number; // batch price
  skipped: { alreadyRead: number; duplicates: number; unnamed: number };
  /** Everything the full batch has read so far, across resumes (pilot not included). */
  batch: { total: number; read: number; failed: number; open: number; cost: number };
  pilotCost: number;
  firstChunkPending: boolean;
  retryable: number; // files "Retry failed" would send again
  queued: number; // files queued by "Retry failed", not sent yet
}

// One primary (amber) button per section: the main next step. Everything else is secondary.
const button = "bb-btn bb-btn-primary px-5";
const ghost = "bb-btn bb-btn-secondary px-5";
const usd = (n: number) => `$${n.toFixed(2)}`;

function Status({ state }: { state: AiState }) {
  return (
    <p role="status" aria-live="polite" className="mt-2 text-lg">
      {state.error && <span className="bb-error">{state.error}</span>}
      {state.summary && <span className="text-bb-cue-gray">{state.summary}</span>}
    </p>
  );
}

export function AiPanel({ s }: { s: AiSummary }) {
  const [pilot, pilotAction, pilotPending] = useActionState<AiState, FormData>(runPilot, {});
  const [approve, approveAction, approvePending] = useActionState<AiState, FormData>(approvePilot, {});

  return (
    <section aria-labelledby="ai-h" className="bb-panel mb-6 p-4">
      <h2 id="ai-h" className="text-2xl font-bold">Read charts with AI</h2>
      <p className="mb-3 text-bb-cue-gray">
        Claude Opus 5.5 reads each PDF into chart text. Every result waits for a human in needs review. Cap{" "}
        <span className="tabular-nums text-bb-chart-white">{s.cap ? usd(s.cap) : "not set"}</span>.
      </p>

      <dl className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {(
          [
            ["Done", s.done],
            ["Needs manual", s.needsManual],
            ["Failed", s.failed],
            ["Skipped", s.skipped.alreadyRead + s.skipped.duplicates + s.skipped.unnamed],
            ["In progress", s.processing],
            [s.reserved > 0 ? `Spent · ${usd(s.reserved)} held` : "Spent", usd(s.spent)],
            [`Est. remaining · ${s.remaining} files`, usd(s.remaining * s.estPerSong)],
          ] as const
        ).map(([label, v]) => (
          <div key={label} className="border border-bb-rule-gray p-3">
            <dt className="text-sm text-bb-cue-gray">{label}</dt>
            <dd className="text-2xl font-bold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mb-3 tabular-nums text-bb-cue-gray">
        Skipped: {s.skipped.alreadyRead} already read · {s.skipped.duplicates} duplicate PDFs (read once) ·{" "}
        {s.skipped.unnamed} with no title/artist (read once they&apos;re named below)
      </p>

      {!s.configured && (
        <p className="mb-3 text-lg">Set ANTHROPIC_API_KEY and MAX_AI_SPEND_USD on the server to start.</p>
      )}

      {!s.pilotApproved && (
        <div className="flex flex-col gap-3">
          <form action={pilotAction}>
            <button type="submit" className={s.pilotCount ? ghost : button} disabled={!s.configured || pilotPending}>
              {pilotPending ? "Reading 20 charts… about 2 minutes" : s.pilotCount ? "Run 20 more pilot songs" : "Run pilot (20 songs)"}
            </button>
            <Status state={pilot} />
          </form>
          {s.pilotCount > 0 && (
            <form action={approveAction}>
              <p className="mb-2 text-lg">
                Check the <a href="#pilot" className="text-bb-chart-white underline">pilot results</a> against their PDFs. The
                full batch stays locked until you approve.
              </p>
              <button type="submit" className={button} disabled={approvePending}>
                {approvePending ? "Approving…" : "Approve pilot"}
              </button>
              <Status state={approve} />
            </form>
          )}
        </div>
      )}

      {s.pilotApproved && <BatchRunner s={s} />}
    </section>
  );
}

const reviewQueue = "/admin/review/queue";

/** Keeps calling batchStep while this page is open. Stop any time; Resume continues. */
function BatchRunner({ s }: { s: AiSummary }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [askRetry, setAskRetry] = useState(false);
  const [last, setLast] = useState<AiState>({});
  const stop = useRef(false);

  useEffect(() => {
    if (!running) return;
    stop.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      let res: AiState;
      try {
        res = await batchStep({});
      } catch (e) {
        res = { error: e instanceof Error ? e.message : "Lost the connection. Press Resume to continue." };
      }
      setLast(res);
      router.refresh();
      if (stop.current) return;
      if (res.error || (!res.more && !res.open)) {
        setRunning(false);
        return;
      }
      // More to send: go again soon. Only waiting on batches: check every 30 s.
      timer = setTimeout(tick, res.more ? 1_000 : 30_000);
    };
    tick();
    return () => {
      stop.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [running, router]);

  const act = async (fn: (p: AiState) => Promise<AiState>) => {
    setBusy(true);
    const res = await fn({});
    setBusy(false);
    setLast(res);
    router.refresh();
    if (res.ok) setRunning(true);
  };

  const finished = s.remaining === 0 && s.processing === 0 && s.batch.total > 0;
  const checkFirst = s.firstChunkPending && s.processing === 0;
  const label = s.batch.total === 0 ? "Run full batch" : "Resume full batch";

  return (
    <div className="flex flex-col gap-3">
      {finished && !running && <Summary s={s} />}

      {checkFirst && !running ? (
        <div className="border border-bb-rule-gray p-3">
          <p className="mb-2 text-lg tabular-nums">
            <b>First chunk done:</b> {s.batch.read} read, {s.batch.failed} failed, {usd(s.batch.cost)}. Check those charts in
            the review queue before the rest is sent.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href={reviewQueue} className={`${ghost} inline-flex items-center`}>
              Open review queue
            </Link>
            <button type="button" className={button} disabled={!s.configured || busy} onClick={() => act(confirmFirstChunk)}>
              {busy ? "Starting…" : "Continue full batch"}
            </button>
          </div>
        </div>
      ) : (
        !(finished && !running && s.queued === 0) && (
          <button
            type="button"
            className={running || askRetry || finished ? ghost : button}
            onClick={() => setRunning((r) => !r)}
            disabled={!s.configured || busy}
          >
            {running ? "Stop" : label}
          </button>
        )
      )}
      {running && (
        <p className="text-bb-cue-gray">
          Keep this page open; it sends {25} PDFs per batch. Stop any time, and Resume picks up where it left off.
        </p>
      )}

      {s.retryable > 0 && !running && !checkFirst && (
        <div>
          {askRetry ? (
            <div className="border border-bb-rule-gray p-3">
              <p className="mb-2 text-lg tabular-nums">
                Read {s.retryable} failed file{s.retryable === 1 ? "" : "s"} again? About {usd(s.retryable * s.estPerSong)}{" "}
                at batch price, billed again, under the same cap. Done files are not touched.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className={button}
                  disabled={!s.configured || busy}
                  onClick={() => {
                    setAskRetry(false);
                    act(retryFailed);
                  }}
                >
                  {busy ? "Queuing…" : "Yes, retry"}
                </button>
                <button type="button" className={ghost} onClick={() => setAskRetry(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className={ghost} disabled={!s.configured || busy} onClick={() => setAskRetry(true)}>
              Retry failed ({s.retryable})
            </button>
          )}
        </div>
      )}

      <Status state={last} />
    </div>
  );
}

function Summary({ s }: { s: AiSummary }) {
  return (
    <div className="border border-bb-rule-gray p-3">
      <h3 className="text-xl font-bold">Full batch finished</h3>
      <dl className="my-2 grid grid-cols-3 gap-3">
        {(
          [
            ["Read", s.batch.read],
            ["Failed", s.batch.failed],
            ["Cost", usd(s.batch.cost)],
          ] as const
        ).map(([label, v]) => (
          <div key={label}>
            <dt className="text-sm text-bb-cue-gray">{label}</dt>
            <dd className="text-2xl font-bold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mb-2 tabular-nums text-bb-cue-gray">
        Plus the pilot: {s.pilotCount} read, {usd(s.pilotCost)}. Failed means needs manual, refused or not read.
      </p>
      <Link href={reviewQueue} className={`${button} inline-flex items-center`}>
        Open review queue
      </Link>
    </div>
  );
}
