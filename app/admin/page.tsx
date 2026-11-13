import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, sessionClient, syncRole } from "@/lib/supabase/session";

export const metadata = { title: "Admin · Broadway Book", robots: { index: false } };

export default function AdminPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-2">
      <Suspense fallback={<p className="text-lg text-muted">Loading…</p>}>
        <Dashboard />
      </Suspense>
    </main>
  );
}

interface Stats {
  songs: number;
  published: number;
  open_proposals: number;
  open_reports: number;
  imports: number;
  people: number;
}

const SECTIONS = [
  { title: "Import", path: "/admin/import", text: "Read Dropbox PDFs into charts and review the AI's work.", ready: true },
  { title: "Suggestions", path: "/community", text: "Open suggestions. Admins can approve now or close from each one.", ready: true },
  { title: "Community", path: "/admin/community", text: "Vote rules, reports and blocked players.", ready: true },
];

async function Dashboard() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin");
  await syncRole(user.id, user.email, user.role);

  // The database decides: admin_dashboard() raises for anyone who isn't an admin.
  const db = await sessionClient();
  const { data, error } = await db.rpc("admin_dashboard");
  if (error || !data) notFound();
  const s = data as Stats;

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">Admin</h1>
      <p className="mb-6 mt-1 text-lg text-muted">Signed in as {user.display_name ?? user.email}</p>

      <dl className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Songs", s.songs],
          ["Published", s.published],
          ["Open proposals", s.open_proposals],
          ["Open reports", s.open_reports ?? 0],
        ].map(([label, n]) => (
          <div key={label} className="rounded-xl border border-line bg-panel p-4">
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="text-3xl font-bold">{n}</dd>
          </div>
        ))}
      </dl>

      <ul className="flex flex-col gap-3">
        {SECTIONS.map((sec) => (
          <li key={sec.path} className="rounded-xl border border-line bg-panel p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-xl font-semibold">{sec.title}</h2>
              {"ready" in sec ? (
                <Link href={sec.path} className="inline-flex min-h-11 items-center text-lg text-accent">
                  Open →
                </Link>
              ) : (
                <span className="text-sm text-accent">Coming soon</span>
              )}
            </div>
            <p className="mt-1 text-lg text-muted">{sec.text}</p>
          </li>
        ))}
      </ul>
    </>
  );
}
