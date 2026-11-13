import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, sessionClient, syncRole } from "@/lib/supabase/session";
import { when } from "@/app/community/ui";
import { BlockToggle, ResolveButton, SettingsForm } from "./AdminForms";

export const metadata = { title: "Community admin · Broadway Book", robots: { index: false } };

export default function AdminCommunityPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-2">
      <Link href="/admin" className="inline-flex h-12 items-center text-lg text-muted active:text-foreground">
        ← Admin
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">Community</h1>
      <Suspense fallback={<p className="text-lg text-muted">Loading…</p>}>
        <Body />
      </Suspense>
    </main>
  );
}

interface Report {
  id: string;
  reason: string;
  details: string | null;
  created_at: string;
  voter_id: string | null;
  reporter: { display_name: string | null } | null;
  voter: { display_name: string | null; blocked: boolean } | null;
  proposal: {
    id: string;
    note: string | null;
    author_id: string;
    author: { display_name: string | null; blocked: boolean } | null;
    song: { title: string } | null;
  } | null;
}

const REASON: Record<string, string> = {
  lyrics: "Contains lyrics",
  wrong: "Wrong on purpose",
  spam: "Spam",
  abusive: "Rude or abusive",
  other: "Something else",
};

async function Body() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/community");
  const role = await syncRole(user.id, user.email, user.role);
  if (role !== "admin") notFound();
  const db = await sessionClient();

  const [settings, reports, blocked] = await Promise.all([
    db.from("settings").select("key, value, label").order("key"),
    db
      .from("reports")
      .select(
        "id, reason, details, created_at, voter_id, reporter:profiles!reports_reporter_id_fkey(display_name), voter:profiles!reports_voter_id_fkey(display_name, blocked), proposal:proposals(id, note, author_id, author:profiles!proposals_author_id_fkey(display_name, blocked), song:songs(title))",
      )
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(100),
    db.from("profiles").select("id, display_name").eq("blocked", true).order("display_name"),
  ]);
  const open = (reports.data ?? []) as unknown as Report[];

  return (
    <>
      <section className="mt-6">
        <h2 className="mb-2 text-2xl font-bold">Rules</h2>
        <SettingsForm settings={settings.data ?? []} />
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-2xl font-bold">Reports ({open.length})</h2>
        {reports.error && <p className="text-red-300">{reports.error.message}</p>}
        {!open.length && <p className="rounded-xl border border-line bg-panel p-4 text-lg text-muted">No open reports.</p>}
        <ul className="flex flex-col gap-3">
          {open.map((r) => {
            const target = r.voter_id ? r.voter : r.proposal?.author;
            const targetId = r.voter_id ?? r.proposal?.author_id;
            return (
              <li key={r.id} className="rounded-xl border border-line bg-panel p-4">
                <p className="text-lg font-semibold">
                  {REASON[r.reason] ?? r.reason} · {r.voter_id ? "vote comment" : "suggestion"}
                </p>
                <p className="text-muted">
                  {r.proposal?.song?.title} · reported by {r.reporter?.display_name || "a player"} · {when(r.created_at)}
                </p>
                {r.details && <p className="mt-1 text-lg">“{r.details}”</p>}
                <p className="mt-1 text-muted">
                  About {target?.display_name || "a player"}
                  {target?.blocked ? " (blocked)" : ""}
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  {r.proposal && (
                    <Link href={`/community/${r.proposal.id}`} className="inline-flex min-h-12 items-center rounded-xl border border-line px-4 text-lg">
                      Open
                    </Link>
                  )}
                  <ResolveButton id={r.id} />
                  {targetId && <BlockToggle userId={targetId} blocked={!!target?.blocked} name={target?.display_name || "this player"} />}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-2xl font-bold">Blocked players</h2>
        {!blocked.data?.length && <p className="text-lg text-muted">Nobody is blocked.</p>}
        <ul className="flex flex-col gap-2">
          {(blocked.data ?? []).map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-panel p-3">
              <span className="text-lg">{b.display_name || "Unnamed player"}</span>
              <BlockToggle userId={b.id} blocked name={b.display_name || "this player"} />
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
