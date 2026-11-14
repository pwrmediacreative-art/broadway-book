import Link from "next/link";
import { prefsQuery, type Prefs } from "@/lib/review/queue";
import type { Progress } from "./access";
import QueueControls from "./QueueControls";

/** Top of every review page: links, filter/order, and the progress bar with per-person counts. */
export default function ReviewHeader({ prefs, progress, page }: { prefs: Prefs; progress: Progress; page: "song" | "queue" | "empty" }) {
  const { total, verified, unverified, waiting, people } = progress;
  const pct = (n: number) => (total ? Math.min(100, (n / total) * 100) : 0);
  return (
    <header className="mb-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex flex-wrap gap-x-4 text-lg">
          {page === "queue" ? (
            <Link href={`/admin/review?${prefsQuery(prefs)}`} className="inline-flex min-h-11 items-center text-bb-downbeat-amber">
              Start reviewing ›
            </Link>
          ) : (
            <Link href={`/admin/review/queue?${prefsQuery(prefs)}`} className="inline-flex min-h-11 items-center text-bb-downbeat-amber">
              ☰ Queue
            </Link>
          )}
        </nav>
        <QueueControls prefs={prefs} to={page === "queue" ? "queue" : "next"} />
      </div>
      <div>
        <div
          className="flex h-4 w-full overflow-hidden bg-bb-rule-gray"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={verified}
          aria-label={`${verified} of ${total} charts verified`}
        >
          <div className="h-full bg-bb-chart-white" style={{ width: `${pct(verified)}%` }} />
          <div className="h-full bg-bb-cue-gray" style={{ width: `${pct(unverified)}%` }} />
        </div>
        <p className="mt-1 text-base tabular-nums text-bb-cue-gray">
          <b className="text-bb-chart-white">{verified.toLocaleString()}</b> / {total.toLocaleString()} verified ·{" "}
          <span className="text-bb-chart-white">{unverified.toLocaleString()} live, unverified</span> ·{" "}
          {waiting.toLocaleString()} waiting for review
          {people.length > 0 && (
            <>
              {" · "}
              {people.map((p, i) => (
                <span key={i}>
                  {i > 0 && ", "}
                  <span className={p.me ? "text-bb-chart-white" : undefined}>
                    {p.name} verified {p.total.toLocaleString()}
                    {p.today > 0 && ` (${p.today} today)`}
                  </span>
                </span>
              ))}
            </>
          )}
        </p>
      </div>
    </header>
  );
}
