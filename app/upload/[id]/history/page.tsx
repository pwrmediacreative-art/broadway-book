import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, sessionClient } from "@/lib/supabase/session";
import GoBack from "./GoBack";

export const metadata = { title: "Chart history · Broadway Book", robots: { index: false } };

export default function PrivateHistoryPage({ params }: PageProps<"/upload/[id]/history">) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-2">
      <Suspense fallback={<p className="text-lg text-bb-cue-gray">Loading…</p>}>
        <History params={params} />
      </Suspense>
    </main>
  );
}

async function History({ params }: { params: PageProps<"/upload/[id]/history">["params"] }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  if (!(await getCurrentUser())) redirect(`/login?next=${encodeURIComponent(`/upload/${id}/history`)}`);
  const db = await sessionClient();
  const { data: song } = await db.from("songs").select("id, title, current_revision_id").eq("id", id).eq("status", "private").maybeSingle();
  if (!song) notFound();
  const { data } = await db
    .from("revisions")
    .select("id, created_at, note, chart_text")
    .eq("song_id", id)
    .order("created_at", { ascending: false })
    .limit(200);
  const revs = data ?? [];
  return (
    <>
      <Link href={`/upload/${id}`} className="inline-flex min-h-11 items-center text-lg text-bb-cue-gray">
        ‹ {song.title}
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">Chart history</h1>
      <p className="mb-5 mt-1 text-lg text-bb-cue-gray">Every saved version, newest first. Going back adds a new version, so nothing is lost.</p>
      <ol className="flex flex-col gap-3">
        {revs.map((r) => (
          <li key={r.id} className="bb-panel flex flex-col gap-2 px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-lg font-semibold">{r.note ?? "Saved"}</span>
              <time className="text-base text-bb-cue-gray" dateTime={r.created_at}>
                {new Date(r.created_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" })}
              </time>
            </div>
            {r.id === song.current_revision_id ? (
              <span className="bb-chip self-start">Current</span>
            ) : (
              <GoBack id={id} text={r.chart_text} when={r.created_at} />
            )}
          </li>
        ))}
      </ol>
    </>
  );
}
