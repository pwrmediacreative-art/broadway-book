"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { approvePilot, batchStep, runPilot, type AiState } from "./ai-actions";

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
}

const button = "min-h-11 rounded-xl bg-accent px-5 text-lg font-semibold text-black disabled:opacity-60";
const ghost = "min-h-11 rounded-xl border border-line px-5 text-lg font-semibold text-foreground disabled:opacity-60";
const usd = (n: number) => `$${n.toFixed(2)}`;

function Status({ state }: { state: AiState }) {
  return (
    <p role="status" aria-live="polite" className="mt-2 text-lg">
      {state.error && <span className="text-red-400">{state.error}</span>}
      {state.summary && <span className="text-muted">{state.summary}</span>}
    </p>
  );
}

export function AiPanel({ s }: { s: AiSummary }) {
  const [pilot, pilotAction, pilotPending] = useActionState<AiState, FormData>(runPilot, {});
  const [approve, approveAction, approvePending] = useActionState<AiState, FormData>(approvePilot, {});

  return (
    <section aria-labelledby="ai-h" className="mb-6 rounded-xl border border-line bg-panel p-4">
      <h2 id="ai-h" className="text-2xl font-bold">Read charts with AI</h2>
      <p className="mb-3 text-muted">
        Claude Opus 5.5 reads each PDF into chart text. Every result waits for a human in needs review. Cap{" "}
        <span className="text-foreground">{s.cap ? usd(s.cap) : "not set"}</span>.
      </p>

      <dl className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {(
          [
            ["Done", s.done],
            ["Needs manual", s.needsManual],
            ["Failed", s.failed],
            ["In progress", s.processing],
            ["Spent", `${usd(s.spent)}${s.reserved > 0 ? ` +${usd(s.reserved)} held` : ""}`],
            ["Est. remaining", `${usd(s.remaining * s.estPerSong)} · ${s.remaining}`],
          ] as const
        ).map(([label, v]) => (
          <div key={label} className="rounded-lg border border-line p-3">
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="text-2xl font-bold">{v}</dd>
          </div>
        ))}
      </dl>
      {s.unnamed > 0 && (
        <p className="mb-3 text-muted">{s.unnamed} files without a title and artist are skipped until they&apos;re named below.</p>
      )}

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
                Check the <a href="#pilot" className="text-accent underline">pilot results</a> against their PDFs. The
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

/** Keeps calling batchStep while this page is open. Stop any time; Run again resumes. */
function BatchRunner({ s }: { s: AiSummary }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [last, setLast] = useState<AiState>({});
  const stop = useRef(false);

  useEffect(() => {
    if (!running) return;
    stop.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const res = await batchStep({});
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

  const finished = s.remaining === 0 && s.processing === 0;
  return (
    <div>
      {finished ? (
        <p className="text-lg">Every named file has been read. Results are in needs review.</p>
      ) : (
        <button type="button" className={running ? ghost : button} onClick={() => setRunning((r) => !r)} disabled={!s.configured}>
          {running ? "Stop" : s.done + s.processing > s.pilotCount ? "Resume full batch" : "Run full batch"}
        </button>
      )}
      {running && <p className="mt-2 text-muted">Keep this page open. Batches usually finish within an hour.</p>}
      <Status state={last} />
    </div>
  );
}
