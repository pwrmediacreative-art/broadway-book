import Link from "next/link";
import { notFound } from "next/navigation";
import { getSong } from "@/lib/supabase/server";
import ChartDisplay from "./ChartDisplay";

export const revalidate = 60;

export async function generateMetadata({ params }: PageProps<"/songs/[slug]">) {
  const { slug } = await params;
  const song = await getSong(slug);
  return { title: song ? `${song.title} · Broadway Book` : "Song not found · Broadway Book" };
}

export default async function SongPage({ params }: PageProps<"/songs/[slug]">) {
  const { slug } = await params;
  const song = await getSong(slug);
  if (!song || !song.chart_text) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-4">
      <Link href="/" className="mb-3 inline-flex h-11 items-center text-lg text-muted active:text-foreground">
        ← All songs
      </Link>
      <header className="mb-3">
        <h1 className="text-3xl font-bold leading-tight">{song.title}</h1>
        <p className="text-lg text-muted">
          {song.artist}
          {song.is_example && (
            <span className="ml-2 rounded bg-accent/20 px-1.5 py-0.5 text-xs font-semibold uppercase text-accent">
              Example
            </span>
          )}
        </p>
      </header>
      <ChartDisplay chartText={song.chart_text} />
    </main>
  );
}
