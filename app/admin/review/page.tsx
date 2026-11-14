import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FILTERS, prefsQuery } from "@/lib/review/queue";
import { reviewContext } from "./access";
import ReviewHeader from "./ReviewHeader";

export const metadata = { title: "Review · Broadway Book", robots: { index: false } };

type SearchParams = Promise<{ f?: string | string[]; o?: string | string[] }>;

/** Straight into the next song nobody else is reviewing, in the chosen order. */
export default function ReviewPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-2">
      <Suspense fallback={<p className="text-lg text-bb-cue-gray">Finding the next chart…</p>}>
        <Next searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Next({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { db, prefs, picked, progress } = await reviewContext("/admin/review", sp);
  if (!progress) notFound(); // the database refuses anyone who isn't an admin or reviewer
  const { data: id } = await db.rpc("review_next", { p_filter: prefs.filter, p_order: prefs.order, p_skip: [] });
  if (id) redirect(`/admin/review/${id}?${prefsQuery(prefs)}`);
  // The default view (Unverified) is empty and nobody chose it: carry on with Needs review.
  if (!picked && prefs.filter === "unverified") {
    const next = { ...prefs, filter: "needs_review" as const };
    const { data: nid } = await db.rpc("review_next", { p_filter: next.filter, p_order: next.order, p_skip: [] });
    if (nid) redirect(`/admin/review/${nid}?${prefsQuery(next)}`);
  }
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">Review</h1>
      <ReviewHeader prefs={prefs} progress={progress} page="empty" />
      <p className="rounded-xl border border-bb-rule-gray bg-bb-case-charcoal p-4 text-lg">
        Nothing left in “{FILTERS[prefs.filter]}” that nobody else is reviewing.{" "}
        <Link href={`/admin/review/queue?${prefsQuery(prefs)}`} className="text-bb-downbeat-amber">
          See the queue
        </Link>
      </p>
    </>
  );
}
