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
      <Suspense fallback={<p className="text-lg text-bb-cue-gray">Loading…</p>}>
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
        <Link href="/admin" className="inline-flex min-h-11 items-center text-lg text-bb-downbeat-amber">
          ← Admin
        </Link>
      )}
      <h1 className="text-3xl font-bold tracking-tight">Review queue</h1>
      <p className="mb-3 mt-1 text-lg text-bb-cue-gray">
        Check imported charts against their PDFs. Flagged songs come first; held ones last.
      </p>
      <ReviewHeader prefs={prefs} progress={progress} page="queue" />

      <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(Object.keys(FILTERS) as (keyof typeof FILTERS)[]).map((k) => (
          <Link
            key={k}
            href={`/admin/review/queue?f=${k}&o=${prefs.order}`}
            className={`flex min-h-16 flex-col justify-center border p-3 ${prefs.filter === k ? "border-bb-downbeat-amber bg-bb-case-charcoal" : "border-bb-rule-gray bg-bb-case-charcoal"}`}
          >
            <dt className="text-sm text-bb-cue-gray">{FILTERS[k]}</dt>
            <dd className="text-2xl font-bold tabular-nums">{d.counts[k] + (k === "needs_manual" ? d.counts.manual_files_without_song : 0)}</dd>
          </Link>
        ))}
      </dl>

      {admin && prefs.filter === "needs_review" && <BulkPublish />}
      {admin && prefs.filter === "unverified" && d.counts.unverified > 0 && (
        <Link href="/admin/review/bulk" className="mb-4 flex min-h-14 items-center justify-between border border-bb-rule-gray bg-bb-case-charcoal px-4 text-xl font-semibold active:bg-bb-rule-gray">
          Bulk verify (chart beside its PDF) <span className="text-bb-downbeat-amber">›</span>
        </Link>
      )}

      {progress.oldest.length > 0 && (
        <section className="bb-panel mb-4 p-3" aria-label="Longest unverified">
          <h2 className="mb-1 text-bb-label text-bb-cue-gray">Live and unverified the longest</h2>
          <ul className="divide-y divide-bb-rule-gray">
            {progress.oldest.map((o) => (
              <li key={o.id}>
                <Link href={`/admin/review/${o.id}?f=unverified&o=${prefs.order}`} className="flex min-h-11 items-center justify-between gap-3 py-1 text-lg active:bg-bb-rule-gray">
                  <span className="min-w-0 truncate">
                    <b>{o.title}</b> <span className="text-bb-cue-gray">· {o.artist ?? "no artist"}</span>
                  </span>
                  <span className="shrink-0 text-base text-bb-cue-gray">{sinceLabel(o.since)}</span>
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
        <input id="q" name="q" defaultValue={q} placeholder="Title or artist" className="bb-input w-full px-3 text-lg" />
        <button type="submit" className="bb-btn bb-btn-secondary px-5 text-lg">
          Search
        </button>
      </form>

      {d.songs.length === 0 ? (
        <p className="bb-panel p-4 text-lg text-bb-cue-gray">{q ? "No matches." : "Nothing here."}</p>
      ) : (
        <ul className="divide-y divide-bb-rule-gray border-y border-bb-rule-gray">
          {d.songs.map((s) => (
            <li key={s.id}>
              <Link href={`/admin/review/${s.id}?${pq}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 active:bg-bb-case-charcoal">
                <span className="min-w-0">
                  <span className="block truncate text-lg font-semibold">{s.title}</span>
                  <span className="block truncate text-bb-cue-gray">{s.artist ?? "no artist"}</span>
                </span>
                <span className="flex shrink-0 flex-wrap justify-end gap-1.5 text-sm">
                  {s.claim_expires && s.claimed_by_me === false && (
                    <span className="bb-chip">{s.claimed_name} reviewing</span>
                  )}
                  {s.flagged && <span className="bb-chip bb-chip-error">{s.flags} flags</span>}
                  {s.has_draft && <span className="bb-chip bb-chip-muted">draft</span>}
                  {s.review_hold && <span className="bb-chip bb-chip-muted">held</span>}
                  {s.status === "published" &&
                    (s.unverified ? (
                      <span className="bb-chip">live, unverified</span>
                    ) : (
                      <span className="bb-chip">live</span>
                    ))}
                  <span className={`bb-chip ${s.unclear ? "" : "bb-chip-muted"}`}>
                    {s.unclear} unclear
                  </span>
                  {s.confidence != null && <span className="bb-chip bb-chip-muted font-bb-data">{Number(s.confidence).toFixed(2)}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <nav className="mt-4 flex items-center justify-between text-lg" aria-label="Pages">
        {page > 0 ? <Link href={qs(page - 1)} className="inline-flex min-h-11 items-center text-bb-downbeat-amber">‹ Previous</Link> : <span />}
        <span className="tabular-nums text-bb-cue-gray">
          {d.matches ? `${page * PAGE + 1}–${Math.min((page + 1) * PAGE, d.matches)} of ${d.matches}` : ""}
        </span>
        {(page + 1) * PAGE < d.matches ? <Link href={qs(page + 1)} className="inline-flex min-h-11 items-center text-bb-downbeat-amber">Next ›</Link> : <span />}
      </nav>

      {files.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-2xl font-bold">Can&apos;t-read PDFs without a song yet</h2>
          <ul className="divide-y divide-bb-rule-gray border-y border-bb-rule-gray">
            {files.map((f) => (
              <ManualFile key={f.id} id={f.id} q={pq} label={f.title && f.artist ? `${f.title} · ${f.artist}` : (f.file_name ?? "Unnamed file")} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
