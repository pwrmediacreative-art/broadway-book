import Link from "next/link";
import VersionList from "./VersionList";

export const metadata = { title: "My versions · Broadway Book", robots: { index: false } };

export default function MyVersionsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-2">
      <Link href="/profile" className="inline-flex h-12 items-center text-lg text-muted active:text-foreground">
        ← Profile
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">My versions</h1>
      <p className="mb-5 mt-1 text-lg text-muted">Songs you changed just for yourself. Only you can see these.</p>
      <VersionList />
    </main>
  );
}
