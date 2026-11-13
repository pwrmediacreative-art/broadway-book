import { notFound } from "next/navigation";
import { listSongs } from "@/lib/supabase/server";
import { songPageData } from "./data";
import SongView from "./SongView";

export async function generateStaticParams() {
  const songs = await listSongs();
  return songs.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: PageProps<"/songs/[slug]">) {
  const { slug } = await params;
  const { song } = await songPageData(slug);
  return { title: song ? `${song.title} · Broadway Book` : "Song not found · Broadway Book" };
}

export default async function SongPage({ params }: PageProps<"/songs/[slug]">) {
  const { slug } = await params;
  const { song, neighbors } = await songPageData(slug);
  if (!song || !song.chart_text) notFound();

  return (
    <SongView
      slug={song.slug}
      songId={song.id}
      title={song.title}
      artist={song.artist}
      isExample={song.is_example}
      unverified={song.unverified}
      chartText={song.chart_text}
      neighbors={neighbors}
    />
  );
}
