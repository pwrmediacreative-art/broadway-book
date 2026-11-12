import { notFound } from "next/navigation";
import { listSongs } from "@/lib/supabase/server";
import { songPageData } from "../data";
import StageView from "../StageView";

export async function generateStaticParams() {
  const songs = await listSongs();
  return songs.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: PageProps<"/songs/[slug]/stage">) {
  const { slug } = await params;
  const { song } = await songPageData(slug);
  return { title: song ? `${song.title} · Stage · Broadway Book` : "Song not found · Broadway Book" };
}

/** Stage mode: just the chart, sized to the screen, for reading mid-set. */
export default async function StagePage({ params }: PageProps<"/songs/[slug]/stage">) {
  const { slug } = await params;
  const { song, neighbors } = await songPageData(slug);
  if (!song || !song.chart_text) notFound();

  return <StageView slug={song.slug} title={song.title} chartText={song.chart_text} neighbors={neighbors} />;
}
