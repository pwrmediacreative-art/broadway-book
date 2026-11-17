import NotesView from "./NotesView";

export const metadata = { title: "My notes · Broadway Book", robots: { index: false } };

/** Everything a player marked: bar flags and "Just for me" versions, by song, newest first. */
export default function NotesPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-2">
      <h1 className="mt-2 text-3xl font-bold tracking-tight">My notes</h1>
      <p className="mb-4 mt-1 text-lg text-bb-cue-gray">Your flags and your own versions. Only you can see these.</p>
      <NotesView />
    </main>
  );
}
