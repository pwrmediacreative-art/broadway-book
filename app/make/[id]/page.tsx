import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { fromText } from "@/lib/make/model";
import { getCurrentUser, sessionClient } from "@/lib/supabase/session";
import Builder from "./Builder";

export const metadata = { title: "Make a chart · Broadway Book", robots: { index: false } };

export default function MakeChartPage({ params, searchParams }: PageProps<"/make/[id]">) {
  return (
    <Suspense fallback={<p className="p-4 text-lg text-bb-cue-gray">Loading…</p>}>
      <Inner params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Inner({ params, searchParams }: { params: PageProps<"/make/[id]">["params"]; searchParams: PageProps<"/make/[id]">["searchParams"] }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/make/${id}`)}`);
  const db = await sessionClient();
  const { data } = await db
    .from("songs")
    .select("id, slug, status, owner_id, current:revisions!songs_current_revision_fk(chart_text)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  // Approved: it's a library song now; changes go through Suggest a change.
  if (data.status === "published") redirect(`/songs/${data.slug}`);
  const { data: made } = await db.from("made_charts").select("song_id").eq("song_id", id).maybeSingle();
  const isMade = !!made;
  const text = (data.current as unknown as { chart_text: string } | null)?.chart_text;
  if (data.status !== "private" || data.owner_id !== user.id || !isMade || !text) notFound();

  const { data: open } = await db.from("proposals").select("id").eq("song_id", id).eq("kind", "new_song").eq("status", "open").maybeSingle();
  const setlist = typeof sp.setlist === "string" && /^[0-9a-f-]{36}$/.test(sp.setlist) ? sp.setlist : null;

  try {
    fromText(text);
  } catch (e) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6">
        <p className="bb-error px-3 py-2 text-lg">This chart can&apos;t open in the editor: {(e as Error).message}</p>
      </main>
    );
  }
  return (
    <Builder
      id={id}
      slug={data.slug}
      initialText={text}
      locked={!!open}
      proposalId={open?.id ?? null}
      setlist={setlist}
      setlistError={sp.setlistError === "1"}
    />
  );
}
