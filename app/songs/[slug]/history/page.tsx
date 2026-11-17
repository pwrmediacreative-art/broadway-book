import { Suspense } from "react";
import Link from "next/link";
import { diffCharts } from "@/lib/chart";
import { getCurrentUser, sessionClient } from "@/lib/supabase/session";
import BarDiff, { DiffSummary } from "@/app/community/BarDiff";
import { SOURCE_LABEL, when } from "@/app/community/ui";
import { songName } from "@/app/community/rename";
import RevertButton from "./RevertButton";
import { movedOrNotFound } from "../data";

export const metadata = { title: "Chart history · Broadway Book" };

export default function HistoryPage({ params }: PageProps<"/songs/[slug]/history">) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-2">
      <Suspense fallback={<p className="text-lg text-bb-cue-gray">Loading…</p>}>
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

interface StatusRow {
  id: number;
  created_at: string;
  status: "verified" | "unverified";
  reason: string;
  by: { display_name: string | null } | null;
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
  if (!song) return movedOrNotFound(slug, "/history");

  const [revs, merged, statuses, renames] = await Promise.all([
    db
      .from("revisions")
      .select("id, created_at, source, note, chart_text, author:profiles(display_name)")
      .eq("song_id", song.id)
      .order("created_at", { ascending: false })
      .limit(200),
    db.from("proposals").select("id, resulting_revision_id").eq("song_id", song.id).eq("status", "approved"),
    db
      .from("verification_log")
      .select("id, created_at, status, reason, by:profiles(display_name)")
      .eq("song_id", song.id)
      .order("created_at", { ascending: false })
      .limit(200),
    db
      .from("song_renames")
      .select("id, created_at, old_title, old_artist, new_title, new_artist, via, by:profiles(display_name)")
      .eq("song_id", song.id)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  const list = (revs.data ?? []) as unknown as Rev[];
  const status = (statuses.data ?? []) as unknown as StatusRow[];
  const names = (renames.data ?? []) as unknown as RenameEvent[];
  // Versions, status changes and name changes in one timeline, newest first (a status or name
  // change sorts above the version it happened to when both carry the same time).
  type Item = { kind: "rev"; r: Rev; i: number } | { kind: "status"; s: StatusRow } | { kind: "rename"; n: RenameEvent };
  const at = (t: Item) => Date.parse(t.kind === "rev" ? t.r.created_at : t.kind === "status" ? t.s.created_at : t.n.created_at);
  const timeline: Item[] = [
    ...list.map((r, i) => ({ kind: "rev" as const, r, i })),
    ...status.map((s) => ({ kind: "status" as const, s })),
    ...names.map((n) => ({ kind: "rename" as const, n })),
  ].sort((a, b) => at(b) - at(a) || (a.kind === "rev" ? 1 : 0) - (b.kind === "rev" ? 1 : 0));
  const fromProposal = new Map((merged.data ?? []).map((p) => [p.resulting_revision_id, p.id]));
  const admin = user?.role === "admin";

  return (
    <>
      <Link href={`/songs/${slug}`} className="inline-flex h-12 items-center text-lg text-bb-cue-gray active:text-bb-chart-white">
        ← {song.title}
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">Chart history</h1>
      <p className="mb-5 mt-1 text-lg text-bb-cue-gray">
        Every version that has been live and every change of its Verified status or name, newest first. Nothing here is ever deleted
        {admin ? "; reverting adds a new version." : "."}
      </p>
      <ol className="divide-y divide-bb-rule-gray border-y border-bb-rule-gray">
        {timeline.map((t) => {
          if (t.kind === "rename") {
            const { n } = t;
            return (
              <li key={`n${n.id}`} className="px-4 py-3" data-rename-row>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="bb-chip bb-chip-muted">Renamed</span>
                  <span className="text-bb-cue-gray">{when(n.created_at)}</span>
                </div>
                <p className="mt-1 break-words text-lg">
                  Renamed from “{songName(n.old_title, n.old_artist)}” to “{songName(n.new_title, n.new_artist)}”
                </p>
                <p className="mt-1 text-lg">
                  {n.via === "community" ? (
                    <>
                      <b>Community vote</b> · suggested by {n.by?.display_name || "a player"}
                    </>
                  ) : (
                    <b>{n.by?.display_name || (n.via === "admin" ? "An admin" : "The uploader")}</b>
                  )}
                </p>
              </li>
            );
          }
          if (t.kind === "status") {
            const { s } = t;
            const ok = s.status === "verified";
            return (
              <li key={`s${s.id}`} className="px-4 py-3" data-status-row>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`bb-chip ${ok ? "" : "bb-chip-muted"}`}>
                    {ok ? "✓ Verified" : "Unverified"}
                  </span>
                  <span className="text-bb-cue-gray">{when(s.created_at)}</span>
                </div>
                <p className="mt-1 text-lg">
                  <b>{s.by?.display_name || (ok ? "An admin" : "Automatic")}</b> · {s.reason}
                </p>
              </li>
            );
          }
          const { r, i } = t;
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
            <li key={r.id} className={`p-4 ${live ? "bg-bb-downbeat-amber/15" : ""}`}>
              <div className="flex flex-wrap items-center gap-2">
                {live && <span className="bb-chip">Live</span>}
                <span className="bb-chip bb-chip-muted">{SOURCE_LABEL[r.source] ?? r.source}</span>
                <span className="text-bb-cue-gray">{when(r.created_at)}</span>
              </div>
              <p className="mt-1 text-lg">
                <b>{r.author?.display_name || (r.source === "import" || r.source === "ai" ? "Import" : "A player")}</b>
                {r.note && r.source !== "ai" && <> · “{r.note}”</>}
              </p>
              {pid && (
                <Link href={`/community/${pid}`} className="inline-flex min-h-11 items-center text-bb-chart-white underline">
                  See the suggestion and votes
                </Link>
              )}
              {diff && (
                <details className="mt-1">
                  <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1 text-lg text-bb-cue-gray">
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
