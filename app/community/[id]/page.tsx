import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { diffCharts, type ChartDiff } from "@/lib/chart";
import { getCurrentUser, sessionClient } from "@/lib/supabase/session";
import BarDiff, { DiffSummary } from "../BarDiff";
import { StatusPill, when, ReviewerBadge } from "../ui";
import VotePanel, { type VoteRow } from "./VotePanel";

export const metadata = { title: "Suggestion · Broadway Book" };

export default function ProposalPage({ params }: PageProps<"/community/[id]">) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-2">
      <Link href="/community" className="inline-flex h-12 items-center text-lg text-bb-cue-gray active:text-bb-chart-white">
        ← Community
      </Link>
      <Suspense fallback={<p className="text-lg text-bb-cue-gray">Loading…</p>}>
        <Proposal params={params} />
      </Suspense>
    </main>
  );
}

interface Row {
  id: string;
  song_id: string;
  chart_text: string;
  note: string | null;
  status: "open" | "approved" | "rejected" | "withdrawn";
  created_at: string;
  updated_at: string;
  decided_at: string | null;
  base_revision_id: string | null;
  author_id: string;
  out_of_date: boolean;
  author: { display_name: string | null; blocked: boolean; reviewer: boolean } | null;
  song: { slug: string; title: string; artist: string | null; current_revision_id: string | null } | null;
}

async function Proposal({ params }: { params: PageProps<"/community/[id]">["params"] }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await getCurrentUser(); // calls connection() first, so the Supabase client below runs at request time
  const db = await sessionClient();

  const { data } = await db
    .from("proposals")
    .select(
      "id, song_id, chart_text, note, status, created_at, updated_at, decided_at, base_revision_id, author_id, out_of_date, author:profiles!proposals_author_id_fkey(display_name, blocked, reviewer), song:songs(slug, title, artist, current_revision_id)",
    )
    .eq("id", id)
    .maybeSingle();
  const p = data as unknown as Row | null;
  if (!p || !p.song) notFound();

  const [base, votes, settings] = await Promise.all([
    p.base_revision_id
      ? db.from("revisions").select("chart_text").eq("id", p.base_revision_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db
      .from("votes")
      .select("voter_id, value, comment, created_at, voter:profiles(display_name, reviewer)")
      .eq("proposal_id", id)
      .order("created_at"),
    db.from("settings").select("key, value"),
  ]);

  let diff: ChartDiff | null = null;
  let diffError: string | null = null;
  try {
    diff = diffCharts(base.data?.chart_text ?? "", p.chart_text);
  } catch (e) {
    diffError = (e as Error).message;
  }
  const need = Object.fromEntries((settings.data ?? []).map((s) => [s.key, s.value])) as Record<string, number>;
  const voteRows = (votes.data ?? []) as unknown as VoteRow[];
  const author = p.author?.display_name || "A player";

  return (
    <>
      <header className="mb-4">
        <p className="mb-1 flex flex-wrap items-center gap-2">
          <StatusPill status={p.status} stale={p.out_of_date} />
          <span className="text-bb-cue-gray">Suggested {when(p.created_at)}</span>
        </p>
        <h1 className="text-3xl font-bold leading-tight">
          <Link href={`/songs/${p.song.slug}`} className="active:text-bb-cue-gray">
            {p.song.title}
          </Link>
        </h1>
        {p.song.artist && <p className="text-lg text-bb-cue-gray">{p.song.artist}</p>}
      </header>

      <section className="bb-panel mb-5 p-4">
        <p className="text-sm text-bb-cue-gray">
          {author}
          <ReviewerBadge on={p.author?.reviewer} /> wrote{p.updated_at !== p.created_at && <> · updated {when(p.updated_at)}</>}
        </p>
        <p className="mt-1 text-xl">“{p.note}”</p>
      </section>

      {p.status === "open" && p.out_of_date && (
        <p className="bb-notice mb-5">
          <b>Out of date:</b> The chart changed after this was suggested, so voting is paused. {author} can update it to the newest
          version; votes then start over. It will never overwrite the newer chart.
        </p>
      )}

      <VotePanel
        proposalId={p.id}
        songSlug={p.song.slug}
        status={p.status}
        stale={p.out_of_date}
        authorId={p.author_id}
        authorBlocked={!!p.author?.blocked}
        votes={voteRows}
        approvalsNeeded={need.approvals_needed ?? 3}
        rejectionsNeeded={need.rejections_needed ?? 3}
        me={user ? { id: user.id, admin: user.role === "admin" } : null}
      />

      <section className="mt-8">
        <h2 className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-2xl font-bold">
          What changed
          {diff && (
            <span className="text-base font-normal text-bb-cue-gray">
              <DiffSummary diff={diff} />
            </span>
          )}
        </h2>
        {diff ? (
          <BarDiff diff={diff} />
        ) : (
          <p className="bb-error text-lg">This suggestion can&apos;t be compared: {diffError}</p>
        )}
        <details className="mt-4">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-lg text-bb-cue-gray">Show the full suggested chart text</summary>
          <pre className="bb-panel mt-2 overflow-x-auto whitespace-pre-wrap p-3 font-bb-data text-lg">{p.chart_text}</pre>
        </details>
      </section>
    </>
  );
}
