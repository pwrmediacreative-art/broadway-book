import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, sessionClient } from "@/lib/supabase/session";
import { when } from "@/app/community/ui";
import MarkRead from "./MarkRead";

export const metadata = { title: "Notifications · Broadway Book", robots: { index: false } };

export default function NotificationsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-2">
      <Link href="/" className="inline-flex h-12 items-center text-lg text-muted active:text-foreground">
        ← All songs
      </Link>
      <h1 className="mb-4 text-3xl font-bold tracking-tight">Notifications</h1>
      <Suspense fallback={<p className="text-lg text-muted">Loading…</p>}>
        <List />
      </Suspense>
    </main>
  );
}

interface Row {
  id: string;
  kind: "merged" | "closed" | "out_of_date";
  created_at: string;
  read_at: string | null;
  proposal: { id: string; note: string | null; status: string } | null;
  song: { slug: string; title: string } | null;
}

const TEXT: Record<Row["kind"], [string, string]> = {
  merged: ["✓", "Your suggestion went live"],
  closed: ["✕", "Your suggestion was closed"],
  out_of_date: ["!", "The chart changed under your suggestion. Update it so voting can continue"],
};

async function List() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/notifications");
  const db = await sessionClient();
  const { data } = await db
    .from("notifications")
    .select("id, kind, created_at, read_at, proposal:proposals(id, note, status), song:songs(slug, title)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  const rows = (data ?? []) as unknown as Row[];
  const unread = rows.some((r) => !r.read_at);

  if (!rows.length) return <p className="rounded-xl border border-line bg-panel p-4 text-lg text-muted">Nothing yet.</p>;
  return (
    <>
      {unread && <MarkRead />}
      <ul className="flex flex-col gap-3">
        {rows.map((r) => {
          const [icon, text] = TEXT[r.kind];
          return (
            <li key={r.id}>
              <Link
                href={r.proposal ? `/community/${r.proposal.id}` : r.song ? `/songs/${r.song.slug}` : "/community"}
                className={`flex gap-3 rounded-xl border p-4 active:bg-line ${r.read_at ? "border-line" : "border-accent bg-panel"}`}
              >
                <span className="text-2xl" aria-hidden>
                  {icon}
                </span>
                <span className="min-w-0">
                  <span className="block text-lg font-semibold">{r.song?.title ?? "A song"}</span>
                  <span className="block text-lg">{text}.</span>
                  {r.proposal?.note && <span className="block truncate text-muted">“{r.proposal.note}”</span>}
                  <span className="block text-sm text-muted">{when(r.created_at)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
