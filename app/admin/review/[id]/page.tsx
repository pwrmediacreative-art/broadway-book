import { Suspense } from "react";
import { notFound } from "next/navigation";
import { isUuid } from "@/lib/review/queue";
import { reviewContext } from "../access";
import ReviewHeader from "../ReviewHeader";
import ReviewEditor, { type ReviewSong } from "./ReviewEditor";

export const metadata = { title: "Review chart · Broadway Book", robots: { index: false } };

type SearchParams = Promise<{ f?: string | string[]; o?: string | string[] }>;

export default function ReviewSongPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-16 pt-2">
      <Suspense fallback={<p className="text-lg text-muted">Loading…</p>}>
        <Review params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Review({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { db, prefs, progress } = await reviewContext(`/admin/review/${id}`, sp);
  if (!progress || !isUuid(id)) notFound();
  const { data, error } = await db.rpc("review_song", { p_song_id: id });
  if (error || !data) notFound(); // non-reviewers and unknown songs
  const song = data as ReviewSong;
  return (
    <>
      <ReviewHeader prefs={prefs} progress={progress} page="song" />
      {/* key: a fresh editor per song and per revision */}
      <ReviewEditor key={`${song.id}:${song.revision_id}`} song={song} prefs={prefs} />
    </>
  );
}
