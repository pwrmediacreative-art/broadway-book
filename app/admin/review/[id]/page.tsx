import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, sessionClient } from "@/lib/supabase/session";
import ReviewEditor, { type ReviewSong } from "./ReviewEditor";

export const metadata = { title: "Review chart · Broadway Book", robots: { index: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ReviewSongPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-16 pt-2">
      <Suspense fallback={<p className="text-lg text-muted">Loading…</p>}>
        <Review params={params} />
      </Suspense>
    </main>
  );
}

async function Review({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/admin/review/${id}`)}`);
  if (!UUID.test(id)) notFound();
  const db = await sessionClient();
  const { data, error } = await db.rpc("review_song", { p_song_id: id });
  if (error || !data) notFound(); // non-admins and unknown songs
  const song = data as ReviewSong;
  if (!song.chart_text) {
    return (
      <p className="mt-6 text-lg">
        This song has no chart yet. <Link href="/admin/review" className="text-accent">Back to the queue</Link>
      </p>
    );
  }
  // key: a fresh editor per song and per revision (after a publish, the next song loads clean)
  return <ReviewEditor key={`${song.id}:${song.revision_id}`} song={song} />;
}
