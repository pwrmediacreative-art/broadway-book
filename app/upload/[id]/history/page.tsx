import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, sessionClient } from "@/lib/supabase/session";
import { songName } from "@/app/community/rename";
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

interface RenameEvent {
  id: string;
  created_at: string;
  old_title: string;
  old_artist: string | null;
  new_title: string;
  new_artist: string | null;
  via: "admin" | "owner" | "community";
  by: { display_name: string | null } | null;
}

function Stamp({ iso }: { iso: string }) {
  return (
    <time className="text-base text-bb-cue-gray" dateTime={iso}>
      {new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" })}
    </time>
  );
}

async function History({ params }: { params: PageProps<"/upload/[id]/history">["params"] }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  if (!(await getCurrentUser())) redirect(`/login?next=${encodeURIComponent(`/upload/${id}/history`)}`);
  const db = await sessionClient();
  const { data: song } = await db.from("songs").select("id, title, current_revision_id").eq("id", id).eq("status", "private").maybeSingle();
  if (!song) notFound();
  const [{ data }, renames] = await Promise.all([
    db.from("revisions").select("id, created_at, note, chart_text").eq("song_id", id).order("created_at", { ascending: false }).limit(200),
    db
      .from("song_renames")
      .select("id, created_at, old_title, old_artist, new_title, new_artist, via, by:profiles(display_name)")
      .eq("song_id", id)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  const revs = data ?? [];
  const names = (renames.data ?? []) as unknown as RenameEvent[];
  // Saved versions and name changes in one list, newest first (a rename sorts above a version
  // saved at the same moment).
  const items = [
    ...revs.map((r) => ({ kind: "rev" as const, at: r.created_at, r })),
    ...names.map((n) => ({ kind: "rename" as const, at: n.created_at, n })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.kind === "rev" ? 1 : 0) - (b.kind === "rev" ? 1 : 0));
  return (
    <>
      <Link href={`/upload/${id}`} className="inline-flex min-h-11 items-center text-lg text-bb-cue-gray">
        ‹ {song.title}
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">Chart history</h1>
      <p className="mb-5 mt-1 text-lg text-bb-cue-gray">Every saved version and name change, newest first. Going back adds a new version, so nothing is lost.</p>
      <ol className="flex flex-col gap-3">
        {items.map((t) => {
          if (t.kind === "rename") {
            const { n } = t;
            return (
              <li key={`n${n.id}`} className="flex flex-col gap-1 border border-bb-rule-gray px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-lg font-semibold">Renamed</span>
                  <Stamp iso={n.created_at} />
                </div>
                <p className="break-words text-lg">
                  Renamed from “{songName(n.old_title, n.old_artist)}” to “{songName(n.new_title, n.new_artist)}”
                </p>
                <p className="text-base text-bb-cue-gray">
                  {n.via === "community"
                    ? `Community vote · suggested by ${n.by?.display_name || "a player"}`
                    : `By ${n.by?.display_name || (n.via === "admin" ? "an admin" : "you")}`}
                </p>
              </li>
            );
          }
          const { r } = t;
          return (
            <li key={r.id} className="bb-panel flex flex-col gap-2 px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-lg font-semibold">{r.note ?? "Saved"}</span>
                <Stamp iso={r.created_at} />
              </div>
              {r.id === song.current_revision_id ? (
                <span className="bb-chip self-start">Current</span>
              ) : (
                <GoBack id={id} text={r.chart_text} when={r.created_at} />
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}
