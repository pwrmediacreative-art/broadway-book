import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { diffCharts } from "@/lib/chart";
import { getCurrentUser, sessionClient } from "@/lib/supabase/session";
import BarDiff, { DiffSummary } from "@/app/community/BarDiff";
import { SOURCE_LABEL, when } from "@/app/community/ui";
import RevertButton from "./RevertButton";

export const metadata = { title: "Chart history · Broadway Book" };

export default function HistoryPage({ params }: PageProps<"/songs/[slug]/history">) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-2">
      <Suspense fallback={<p className="text-lg text-muted">Loading…</p>}>
        <History params={params} />
      </Suspense>
    </main>
  );
}

interface Rev {
  id: string;
  created_at: string;
  source: string;
  note: string | null;
  chart_text: string;
  author: { display_name: string | null } | null;
}

async function History({ params }: { params: PageProps<"/songs/[slug]/history">["params"] }) {
  const { slug } = await params;
  const user = await getCurrentUser(); // calls connection() first, so the Supabase client below runs at request time
  const db = await sessionClient();
  const { data: song } = await db
    .from("songs")
    .select("id, title, current_revision_id")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (!song) notFound();

  const [revs, merged] = await Promise.all([
    db
      .from("revisions")
      .select("id, created_at, source, note, chart_text, author:profiles(display_name)")
      .eq("song_id", song.id)
      .order("created_at", { ascending: false })
      .limit(200),
    db.from("proposals").select("id, resulting_revision_id").eq("song_id", song.id).eq("status", "approved"),
  ]);
  const list = (revs.data ?? []) as unknown as Rev[];
  const fromProposal = new Map((merged.data ?? []).map((p) => [p.resulting_revision_id, p.id]));
  const admin = user?.role === "admin";

  return (
    <>
      <Link href={`/songs/${slug}`} className="inline-flex h-12 items-center text-lg text-muted active:text-foreground">
        ← {song.title}
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">Chart history</h1>
      <p className="mb-5 mt-1 text-lg text-muted">
        Every version that has been live, newest first. Nothing here is ever deleted
        {admin ? "; reverting adds a new version." : "."}
      </p>
      <ol className="flex flex-col gap-3">
        {list.map((r, i) => {
          const older = list[i + 1];
          let diff = null;
          try {
            diff = older ? diffCharts(older.chart_text, r.chart_text) : null;
          } catch {
            diff = null;
          }
          const live = r.id === song.current_revision_id;
          const pid = fromProposal.get(r.id);
          return (
            <li key={r.id} className={`rounded-xl border p-4 ${live ? "border-accent" : "border-line"} bg-panel`}>
              <div className="flex flex-wrap items-center gap-2">
                {live && <span className="rounded bg-accent px-2 py-0.5 text-sm font-bold uppercase text-black">Live</span>}
                <span className="rounded bg-background px-2 py-0.5 text-sm font-semibold uppercase text-muted">{SOURCE_LABEL[r.source] ?? r.source}</span>
                <span className="text-muted">{when(r.created_at)}</span>
              </div>
              <p className="mt-1 text-lg">
                <b>{r.author?.display_name || (r.source === "import" || r.source === "ai" ? "Import" : "A player")}</b>
                {r.note && r.source !== "ai" && <> · “{r.note}”</>}
              </p>
              {pid && (
                <Link href={`/community/${pid}`} className="inline-flex min-h-11 items-center text-accent">
                  See the suggestion and votes
                </Link>
              )}
              {diff && (
                <details className="mt-1">
                  <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1 text-lg text-muted">
                    Changes: <DiffSummary diff={diff} />
                  </summary>
                  <BarDiff diff={diff} className="mt-2" />
                </details>
              )}
              {admin && !live && <RevertButton songId={song.id} revisionId={r.id} when={when(r.created_at)} />}
            </li>
          );
        })}
      </ol>
    </>
  );
}
