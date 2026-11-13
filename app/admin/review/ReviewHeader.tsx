import Link from "next/link";
import { prefsQuery, type Prefs } from "@/lib/review/queue";
import type { Progress } from "./access";
import QueueControls from "./QueueControls";

/** Top of every review page: links, filter/order, and the progress bar with per-person counts. */
export default function ReviewHeader({ prefs, progress, page }: { prefs: Prefs; progress: Progress; page: "song" | "queue" | "empty" }) {
  const { total, verified, unverified, people } = progress;
  const live = verified + unverified;
  const pct = (n: number) => (total ? Math.min(100, (n / total) * 100) : 0);
  return (
    <header className="mb-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex flex-wrap gap-x-4 text-lg">
          {page === "queue" ? (
            <Link href={`/admin/review?${prefsQuery(prefs)}`} className="inline-flex min-h-11 items-center text-accent">
              Start reviewing ›
            </Link>
          ) : (
            <Link href={`/admin/review/queue?${prefsQuery(prefs)}`} className="inline-flex min-h-11 items-center text-accent">
              ☰ Queue
            </Link>
          )}
        </nav>
        <QueueControls prefs={prefs} to={page === "queue" ? "queue" : "next"} />
      </div>
      <div>
        <div
          className="flex h-4 w-full overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={live}
          aria-label={`${live} of ${total} charts live`}
        >
          <div className="h-full bg-green-500" style={{ width: `${pct(verified)}%` }} />
          <div className="h-full bg-amber-400" style={{ width: `${pct(unverified)}%` }} />
        </div>
        <p className="mt-1 text-base text-muted">
          <b className="text-foreground">{live.toLocaleString()}</b> / {total.toLocaleString()} live ·{" "}
          <span className="text-green-300">{verified.toLocaleString()} verified</span> ·{" "}
          <span className="text-amber-200">{unverified.toLocaleString()} unverified</span>
          {people.length > 0 && (
            <>
              {" · "}
              {people.map((p, i) => (
                <span key={i}>
                  {i > 0 && ", "}
                  <span className={p.me ? "text-foreground" : undefined}>
                    {p.name} {p.total.toLocaleString()}
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
