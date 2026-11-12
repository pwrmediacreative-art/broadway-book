import { listSongs } from "@/lib/supabase/server";
import SongSearch from "./SongSearch";

export const revalidate = 60;

export default async function Home() {
  const songs = await listSongs();
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-6">
      <header className="mb-4">
        <h1 className="text-3xl font-bold tracking-tight">Broadway Book</h1>
        <p className="text-muted">Nashville number charts. Free, no login to view.</p>
      </header>
      <SongSearch songs={songs} />
    </main>
  );
}
