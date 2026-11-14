import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FILTERS, prefsQuery } from "@/lib/review/queue";
import { reviewContext } from "../access";
import ReviewHeader from "../ReviewHeader";
import BulkPublish from "./BulkPublish";
import ManualFile from "./ManualFile";

export const metadata = { title: "Review queue · Broadway Book", robots: { index: false } };

type SearchParams = Promise<{ q?: string | string[]; page?: string | string[]; f?: string | string[]; o?: string | string[] }>;

export default function QueuePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-2">
      <Suspense fallback={<p className="text-lg text-muted">Loading…</p>}>
        <Queue searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

interface Row {
  id: string;
  title: string;
  artist: string | null;
  status: string;
  unverified: boolean;
  review_hold: boolean;
  unclear: number;
  confidence: number | null;
  flags: number;
  flagged: boolean;
  has_draft: boolean;
  claimed_name: string | null;
  claim_expires: string | null;
  claimed_by_me: boolean | null;
}
interface ListData {
  counts: { unverified: number; verified: number; needs_review: number; needs_manual: number; duplicates: number; manual_files_without_song: number };
  matches: number;
  songs: Row[];
}

const PAGE = 50;
/** "today", "3 days", "2 weeks": how long a chart has been live and unverified. */
function sinceLabel(since: string | null): string {
  if (!since) return "";
  const days = Math.floor((Date.now() - Date.parse(since)) / 86_400_000);
  if (days < 1) return "today";
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  return `${Math.floor(days / 7)} weeks`;
}
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

async function Queue({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { db, prefs, progress } = await reviewContext("/admin/review/queue", sp);
  if (!progress) notFound(); // the database refuses anyone who isn't an admin or reviewer
  const q = one(sp.q).trim().slice(0, 100);
  const page = Math.max(0, Number.parseInt(one(sp.page) || "0", 10) || 0);
  const [{ data, error }, me, manual] = await Promise.all([
    db.rpc("review_list", { p_filter: prefs.filter, p_order: prefs.order, p_q: q, p_limit: PAGE, p_offset: page * PAGE }),
    db.rpc("is_admin"),
    prefs.filter === "needs_manual" ? db.rpc("review_manual_files", { p_limit: 50 }) : Promise.resolve({ data: [] }),
  ]);
  if (error || !data) notFound();
  const d = data as ListData;
  const admin = me.data === true;
  const pq = prefsQuery(prefs);
  const qs = (p: number) => `/admin/review/queue?${pq}&${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;
  const files = (manual.data ?? []) as { id: string; file_name: string | null; title: string | null; artist: string | null }[];

  return (
    <>
      {admin && (
        <Link href="/admin" className="inline-flex min-h-11 items-center text-lg text-accent">
          ← Admin
        </Link>
      )}
      <h1 className="text-3xl font-bold tracking-tight">Review queue</h1>
      <p className="mb-3 mt-1 text-lg text-muted">
        Check imported charts against their PDFs. Flagged songs come first; held ones last.
      </p>
      <ReviewHeader prefs={prefs} progress={progress} page="queue" />

      <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(Object.keys(FILTERS) as (keyof typeof FILTERS)[]).map((k) => (
          <Link
            key={k}
            href={`/admin/review/queue?f=${k}&o=${prefs.order}`}
            className={`flex min-h-16 flex-col justify-center rounded-xl border p-3 ${prefs.filter === k ? "border-accent bg-panel" : "border-line bg-panel"}`}
          >
            <dt className="text-sm text-muted">{FILTERS[k]}</dt>
            <dd className="text-2xl font-bold">{d.counts[k] + (k === "needs_manual" ? d.counts.manual_files_without_song : 0)}</dd>
          </Link>
        ))}
      </dl>

      {admin && prefs.filter === "needs_review" && <BulkPublish />}
      {admin && prefs.filter === "unverified" && d.counts.unverified > 0 && (
        <Link href="/admin/review/bulk" className="mb-4 flex min-h-14 items-center justify-between rounded-xl border border-line bg-panel px-4 text-xl font-semibold active:bg-line">
          Bulk verify (chart beside its PDF) <span className="text-accent">›</span>
        </Link>
      )}

      {progress.oldest.length > 0 && (
        <section className="mb-4 rounded-xl border border-line bg-panel p-3" aria-label="Longest unverified">
          <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-muted">Live and unverified the longest</h2>
          <ul className="divide-y divide-line">
            {progress.oldest.map((o) => (
              <li key={o.id}>
                <Link href={`/admin/review/${o.id}?f=unverified&o=${prefs.order}`} className="flex min-h-11 items-center justify-between gap-3 py-1 text-lg active:bg-line">
                  <span className="min-w-0 truncate">
                    <b>{o.title}</b> <span className="text-muted">· {o.artist ?? "no artist"}</span>
                  </span>
                  <span className="shrink-0 text-base text-muted">{sinceLabel(o.since)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form method="get" className="mb-4 flex gap-2" role="search">
        <input type="hidden" name="f" value={prefs.filter} />
        <input type="hidden" name="o" value={prefs.order} />
        <label htmlFor="q" className="sr-only">Search songs</label>
        <input id="q" name="q" defaultValue={q} placeholder="Title or artist" className="min-h-11 w-full rounded-lg border border-line bg-background px-3 text-lg" />
        <button type="submit" className="min-h-11 rounded-xl bg-accent px-5 text-lg font-semibold text-black">
          Search
        </button>
      </form>

      {d.songs.length === 0 ? (
        <p className="rounded-xl border border-line bg-panel p-4 text-lg text-muted">{q ? "No matches." : "Nothing here."}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {d.songs.map((s) => (
            <li key={s.id}>
              <Link href={`/admin/review/${s.id}?${pq}`} className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-line bg-panel px-4 py-2 active:bg-line">
                <span className="min-w-0">
                  <span className="block truncate text-lg font-semibold">{s.title}</span>
                  <span className="block truncate text-muted">{s.artist ?? "no artist"}</span>
                </span>
                <span className="flex shrink-0 flex-wrap justify-end gap-1.5 text-sm">
                  {s.claim_expires && s.claimed_by_me === false && (
                    <span className="rounded-full bg-sky-400/25 px-2 py-0.5 font-semibold text-sky-100">{s.claimed_name} reviewing</span>
                  )}
                  {s.flagged && <span className="rounded-full bg-red-500/25 px-2 py-0.5 font-semibold text-red-200">{s.flags} flags</span>}
                  {s.has_draft && <span className="rounded-full bg-line px-2 py-0.5 text-muted">draft</span>}
                  {s.review_hold && <span className="rounded-full bg-line px-2 py-0.5 text-muted">held</span>}
                  {s.status === "published" &&
                    (s.unverified ? (
                      <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-amber-200">live, unverified</span>
                    ) : (
                      <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-green-200">live</span>
                    ))}
                  <span className={`rounded-full px-2 py-0.5 ${s.unclear ? "bg-amber-400/20 text-amber-200" : "bg-green-500/20 text-green-200"}`}>
                    {s.unclear} unclear
                  </span>
                  {s.confidence != null && <span className="rounded-full bg-line px-2 py-0.5 text-muted">{Number(s.confidence).toFixed(2)}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <nav className="mt-4 flex items-center justify-between text-lg" aria-label="Pages">
        {page > 0 ? <Link href={qs(page - 1)} className="inline-flex min-h-11 items-center text-accent">‹ Previous</Link> : <span />}
        <span className="text-muted">
          {d.matches ? `${page * PAGE + 1}–${Math.min((page + 1) * PAGE, d.matches)} of ${d.matches}` : ""}
        </span>
        {(page + 1) * PAGE < d.matches ? <Link href={qs(page + 1)} className="inline-flex min-h-11 items-center text-accent">Next ›</Link> : <span />}
      </nav>

      {files.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-2xl font-bold">Can&apos;t-read PDFs without a song yet</h2>
          <ul className="flex flex-col gap-2">
            {files.map((f) => (
              <ManualFile key={f.id} id={f.id} q={pq} label={f.title && f.artist ? `${f.title} · ${f.artist}` : (f.file_name ?? "Unnamed file")} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
