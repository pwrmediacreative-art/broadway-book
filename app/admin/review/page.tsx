import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, sessionClient, syncRole } from "@/lib/supabase/session";
import BulkPublish from "./BulkPublish";

export const metadata = { title: "Review · Broadway Book", robots: { index: false } };

type SearchParams = Promise<{ q?: string | string[]; page?: string | string[] }>;

export default function ReviewPage({ searchParams }: { searchParams: SearchParams }) {
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
  slug: string;
  title: string;
  artist: string | null;
  status: string;
  unverified: boolean;
  review_hold: boolean;
  unclear: number;
  confidence: number | null;
  flags: number;
}
interface QueueData {
  needs_review: number;
  flagged: number;
  held: number;
  unverified: number;
  alert: number;
  matches: number;
  songs: Row[];
}

const PAGE = 50;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

async function Queue({ searchParams }: { searchParams: SearchParams }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/review");
  await syncRole(user.id, user.email, user.role);

  const sp = await searchParams;
  const q = one(sp.q).trim().slice(0, 100);
  const page = Math.max(0, Number.parseInt(one(sp.page) || "0", 10) || 0);
  const db = await sessionClient();
  const { data, error } = await db.rpc("review_queue", { p_q: q, p_limit: PAGE, p_offset: page * PAGE });
  if (error || !data) notFound(); // the database refuses non-admins
  const d = data as QueueData;
  const qs = (p: number) => `/admin/review?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <>
      <Link href="/admin" className="inline-flex min-h-11 items-center text-lg text-accent">
        ← Admin
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">Review charts</h1>
      <p className="mb-4 mt-1 text-lg text-muted">
        Check imported charts against their PDFs. Verified charts have no “# UNCLEAR” notes left.
      </p>

      <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ["To review", d.needs_review],
            ["Flagged", d.flagged],
            ["On hold", d.held],
            ["Live, unverified", d.unverified],
          ] as const
        ).map(([label, n]) => (
          <div key={label} className="rounded-xl border border-line bg-panel p-4">
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="text-3xl font-bold">{n}</dd>
          </div>
        ))}
      </dl>

      <BulkPublish />

      <form method="get" className="mb-4 flex gap-2" role="search">
        <label htmlFor="q" className="sr-only">Search songs</label>
        <input id="q" name="q" defaultValue={q} placeholder="Title or artist" className="min-h-11 w-full rounded-lg border border-line bg-background px-3 text-lg" />
        <button type="submit" className="min-h-11 rounded-xl bg-accent px-5 text-lg font-semibold text-black">
          Search
        </button>
      </form>

      {d.songs.length === 0 ? (
        <p className="rounded-xl border border-line bg-panel p-4 text-lg text-muted">{q ? "No matches." : "Nothing to review."}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {d.songs.map((s) => (
            <li key={s.id}>
              <Link href={`/admin/review/${s.id}`} className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-line bg-panel px-4 py-2 active:bg-line">
                <span className="min-w-0">
                  <span className="block truncate text-lg font-semibold">{s.title}</span>
                  <span className="block truncate text-muted">{s.artist ?? "no artist"}</span>
                </span>
                <span className="flex shrink-0 flex-wrap justify-end gap-1.5 text-sm">
                  {s.flags >= d.alert && <span className="rounded-full bg-red-500/25 px-2 py-0.5 font-semibold text-red-200">{s.flags} flags</span>}
                  {s.review_hold && <span className="rounded-full bg-line px-2 py-0.5 text-muted">held</span>}
                  {s.status === "published" && <span className="rounded-full bg-line px-2 py-0.5 text-muted">live</span>}
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
    </>
  );
}
