import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, sessionClient } from "@/lib/supabase/session";
import Editor from "./Editor";

export const metadata = { title: "Edit chart · Broadway Book", robots: { index: false } };

export default function EditPage({ params, searchParams }: PageProps<"/songs/[slug]/edit">) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-2">
      <Suspense fallback={<p className="text-lg text-bb-cue-gray">Loading…</p>}>
        <Edit params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Edit({
  params,
  searchParams,
}: {
  params: PageProps<"/songs/[slug]/edit">["params"];
  searchParams: PageProps<"/songs/[slug]/edit">["searchParams"];
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const user = await getCurrentUser();
  // Keep the query (?proposal=… or the held bar ?s=&b=&p=) through sign-in.
  const qs = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))).toString();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/songs/${slug}/edit${qs ? `?${qs}` : ""}`)}`);
  // From press-and-hold "Suggest an edit": open on that bar.
  const int = (v: unknown) => (typeof v === "string" && /^\d{1,4}$/.test(v) ? Number(v) : null);
  const [fs, fb, fp] = [int(sp.s), int(sp.b), int(sp.p)];
  const focus = fs !== null && fb !== null && fp !== null ? { section: fs, bar: fb, beat: fp, from: sp.from === "mine" ? ("mine" as const) : ("public" as const) } : null;

  // Fresh (uncached) read: the editor must start from the live revision.
  const db = await sessionClient();
  const { data: song } = await db
    .from("songs")
    .select("id, slug, title, current_revision_id, current:revisions!songs_current_revision_fk(chart_text)")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  const publicText = (song?.current as unknown as { chart_text: string } | null)?.chart_text;
  if (!song || !publicText) notFound();

  let proposal: { id: string; chart_text: string; note: string; base_text: string | null; stale: boolean } | null = null;
  const pid = typeof sp.proposal === "string" ? sp.proposal : null;
  if (pid) {
    const { data: p } = await db
      .from("proposals")
      .select("id, chart_text, note, status, author_id, song_id, base_revision_id")
      .eq("id", pid)
      .maybeSingle();
    if (!p || p.song_id !== song.id || p.author_id !== user.id || p.status !== "open") {
      return (
        <p className="mt-6 text-lg">
          Only the author can edit an open suggestion.{" "}
          <Link href={`/community/${pid}`} className="text-bb-chart-white underline">
            Back to the suggestion
          </Link>
        </p>
      );
    }
    const stale = p.base_revision_id !== song.current_revision_id;
    let baseText: string | null = null;
    if (stale && p.base_revision_id) {
      const { data: b } = await db.from("revisions").select("chart_text").eq("id", p.base_revision_id).maybeSingle();
      baseText = b?.chart_text ?? null;
    }
    proposal = { id: p.id, chart_text: p.chart_text, note: p.note ?? "", base_text: baseText, stale };
  }

  return (
    <Editor
      song={{ id: song.id, slug: song.slug, title: song.title }}
      publicText={publicText}
      publicRevisionId={song.current_revision_id}
      proposal={proposal}
      intent={sp.intent === "suggest" || focus ? "suggest" : null}
      focus={proposal ? null : focus}
    />
  );
}
