import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { reviewContext } from "../access";
import BulkVerify, { type Card } from "./BulkVerify";

export const metadata = { title: "Bulk verify · Broadway Book", robots: { index: false } };

type SearchParams = Promise<{ page?: string | string[] }>;
const PAGE = 20;

export default function BulkVerifyPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-28 pt-2">
      <Suspense fallback={<p className="text-lg text-muted">Loading…</p>}>
        <Bulk searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/** Admins only: live, unverified charts as cards (chart text + its PDF), longest-unverified first. */
async function Bulk({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { db, progress } = await reviewContext("/admin/review/bulk", {});
  if (!progress) notFound();
  const raw = Array.isArray(sp.page) ? sp.page[0] : sp.page;
  const page = Math.max(0, Number.parseInt(raw || "0", 10) || 0);
  // The database refuses anyone who isn't an admin.
  const { data, error } = await db.rpc("review_bulk_cards", { p_limit: PAGE, p_offset: page * PAGE });
  if (error || !data) notFound();
  const d = data as { total: number; cards: Card[] };
  return (
    <>
      <Link href="/admin/review/queue?f=unverified" className="inline-flex min-h-11 items-center text-lg text-accent">
        ← Queue
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">Bulk verify</h1>
      <p className="mb-4 mt-1 text-lg text-muted">
        {d.total.toLocaleString()} live chart{d.total === 1 ? "" : "s"} not verified yet. Open each PDF, compare it with the chart text, then tick the ones that are
        right. A chart can&apos;t be ticked until its PDF has been opened.
      </p>
      {d.cards.length === 0 ? (
        <p className="rounded-xl border border-line bg-panel p-4 text-lg text-muted">Nothing here.</p>
      ) : (
        <BulkVerify key={page} cards={d.cards} />
      )}
      <nav className="mt-4 flex items-center justify-between text-lg" aria-label="Pages">
        {page > 0 ? (
          <Link href={`/admin/review/bulk?page=${page - 1}`} className="inline-flex min-h-11 items-center text-accent">
            ‹ Previous
          </Link>
        ) : (
          <span />
        )}
        <span className="text-muted">{d.total ? `${page * PAGE + 1}–${Math.min((page + 1) * PAGE, d.total)} of ${d.total}` : ""}</span>
        {(page + 1) * PAGE < d.total ? (
          <Link href={`/admin/review/bulk?page=${page + 1}`} className="inline-flex min-h-11 items-center text-accent">
            Next ›
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </>
  );
}
