import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, sessionClient } from "@/lib/supabase/session";
import Workspace, { type UploadInfo } from "./Workspace";
import Rename from "@/app/songs/[slug]/Rename";
import { withName } from "@/lib/songs/name";

export const metadata = { title: "Draft chart · Broadway Book", robots: { index: false } };

export default function UploadResultPage({ params }: PageProps<"/upload/[id]">) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-2">
      <Suspense fallback={<p className="text-lg text-bb-cue-gray">Loading…</p>}>
        <Result params={params} />
      </Suspense>
    </main>
  );
}

async function Result({ params }: { params: PageProps<"/upload/[id]">["params"] }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/upload/${id}`)}`);
  const db = await sessionClient();
  // RLS: only the owner can read a private chart, its revisions and its upload row.
  const { data: song } = await db
    .from("songs")
    .select("id, slug, title, artist, status, current_revision_id, revisions!songs_current_revision_fk(chart_text)")
    .eq("id", id)
    .eq("status", "private")
    .maybeSingle();
  const { data: up } = await db
    .from("uploads")
    .select("source, audio_path, analysis, confidence, confidence_estimated, edited, share_code, sync")
    .eq("song_id", id)
    .maybeSingle();
  const rev = song?.revisions as unknown as { chart_text: string } | null;
  if (!song || !up || !rev?.chart_text) notFound();

  let audioUrl: string | null = null;
  if (up.audio_path) {
    // short-lived link, owner only (storage RLS)
    const { data } = await db.storage.from("audio").createSignedUrl(up.audio_path, 60 * 60);
    audioUrl = data?.signedUrl ?? null;
  }
  const sync = up.sync && typeof up.sync === "object" && "start" in up.sync ? (up.sync as { start: number; bars: number }) : null;
  const info: UploadInfo = {
    source: up.source as UploadInfo["source"],
    hasAnalysis: !!up.analysis,
    confidence: up.confidence,
    estimated: up.confidence_estimated,
    edited: up.edited,
    shareCode: up.share_code,
    sync,
  };
  const maxMb = Number(process.env.MAX_AUDIO_MB) > 0 ? Number(process.env.MAX_AUDIO_MB) : 50;

  return (
    <>
      <Link href="/upload" className="mb-2 inline-flex min-h-11 items-center text-lg text-bb-cue-gray">
        ‹ My uploads
      </Link>
      <h1 className="mb-1 text-3xl font-bold tracking-tight">{song.title}</h1>
      {song.artist && <p className="mb-3 text-lg text-bb-cue-gray">{song.artist}</p>}
      <div className="mb-3">
        <Rename slug={song.slug} songId={song.id} title={song.title} artist={song.artist} direct />
      </div>
      <p className="mb-4 text-base text-bb-cue-gray">Private: only you can see this chart.</p>
      <Workspace id={song.id} slug={song.slug} initialText={withName(rev.chart_text, song.title, song.artist)} info={info} audioUrl={audioUrl} maxMb={maxMb} />
    </>
  );
}
