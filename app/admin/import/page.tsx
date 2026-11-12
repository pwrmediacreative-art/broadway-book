import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { chartFolder, dropboxConfigured } from "@/lib/dropbox/client";
import { getCurrentUser, sessionClient, syncRole } from "@/lib/supabase/session";
import { FixNameForm, ScanButton } from "./forms";

export const metadata = { title: "Import · Broadway Book", robots: { index: false } };

type SearchParams = Promise<{ q?: string | string[] }>;

export default function ImportPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-2">
      <Suspense fallback={<p className="text-lg text-muted">Loading…</p>}>
        <Inventory searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

interface FileRow {
  id: string;
  file_name: string | null;
  title: string | null;
  artist: string | null;
}
interface Overview {
  total: number;
  parsed: number;
  unparsed: number;
  duplicates: number;
  duplicate_groups: number;
  changed: number;
  missing: number;
  last_scan: string | null;
  unparsed_list: FileRow[];
  duplicate_list: (FileRow & { slug: string | null })[];
  changed_list: { id: string; file_name: string; changed_at: string | null }[];
  missing_list: { id: string; file_name: string; path: string }[];
}

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" })
    : "never";

function ViewPdf({ id }: { id: string }) {
  return (
    <a
      href={`/admin/import/pdf/${id}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-line px-3 text-base text-accent"
    >
      View PDF
    </a>
  );
}

function Section({ title, count, open, children }: { title: string; count: number; open?: boolean; children: ReactNode }) {
  return (
    <details open={open} className="mb-4 rounded-xl border border-line bg-panel">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-3 text-xl font-semibold">
        <span>{title}</span>
        <span className="text-muted">{count}</span>
      </summary>
      <div className="border-t border-line px-4 py-3">{count === 0 ? <p className="text-muted">None.</p> : children}</div>
    </details>
  );
}

async function Inventory({ searchParams }: { searchParams: SearchParams }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/import");
  await syncRole(user.id, user.email, user.role);

  // The database decides: import_overview() raises for anyone who isn't an admin.
  const db = await sessionClient();
  const { data, error } = await db.rpc("import_overview");
  if (error || !data) notFound();
  const o = data as Overview;

  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 100) ?? "";
  let results: (FileRow & { missing: boolean })[] = [];
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const res = await db
      .from("import_files")
      .select("id, file_name, title, artist, missing")
      .ilike("file_name", like)
      .order("file_name")
      .limit(50);
    results = res.data ?? [];
  }

  const connected = dropboxConfigured();

  return (
    <>
      <Link href="/admin" className="inline-flex min-h-11 items-center text-lg text-accent">
        ← Admin
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">Import from Dropbox</h1>
      <p className="mb-4 mt-1 text-lg text-muted">
        Folder <span className="text-foreground">{chartFolder()}</span> · last scan {when(o.last_scan)}
      </p>

      {!connected && (
        <p className="mb-4 rounded-xl border border-line bg-panel p-4 text-lg">
          Dropbox isn&apos;t connected yet: set DROPBOX_APP_KEY, DROPBOX_APP_SECRET and DROPBOX_REFRESH_TOKEN.
        </p>
      )}
      <ScanButton disabled={!connected} />

      <dl className="mb-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Total PDFs", o.total],
          ["Parsed", o.parsed],
          ["Unparsed", o.unparsed],
          ["Duplicates", o.duplicates],
        ].map(([label, n]) => (
          <div key={label} className="rounded-xl border border-line bg-panel p-4">
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="text-3xl font-bold">{n}</dd>
          </div>
        ))}
      </dl>
      <p className="mb-6 text-lg text-muted">
        {o.duplicate_groups} duplicate groups · {o.changed} changed since import · {o.missing} missing from Dropbox
      </p>

      <form method="get" className="mb-6 flex gap-2" role="search">
        <label htmlFor="q" className="sr-only">Search files</label>
        <input
          id="q"
          name="q"
          defaultValue={q}
          placeholder="Search filenames"
          className="min-h-11 w-full rounded-lg border border-line bg-background px-3 text-lg"
        />
        <button type="submit" className="min-h-11 rounded-xl bg-accent px-5 text-lg font-semibold text-black">
          Search
        </button>
      </form>
      {q && (
        <Section title={`Results for “${q}”`} count={results.length} open>
          <ul className="flex flex-col gap-3">
            {results.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-lg">{r.title ?? "—"} <span className="text-muted">· {r.artist ?? "no artist"}</span></p>
                  <p className="break-words text-sm text-muted">{r.file_name}{r.missing ? " · missing" : ""}</p>
                </div>
                <ViewPdf id={r.id} />
              </li>
            ))}
          </ul>
          {results.length === 50 && <p className="mt-3 text-muted">Showing the first 50.</p>}
        </Section>
      )}

      <Section title="Unparsed names" count={o.unparsed} open>
        <p className="mb-3 text-muted">No artist in the filename. Set both; saving creates the draft song.</p>
        <ul className="flex flex-col gap-5">
          {o.unparsed_list.map((f) => (
            <li key={f.id}>
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 break-words text-lg">{f.file_name}</p>
                <ViewPdf id={f.id} />
              </div>
              <FixNameForm id={f.id} title={f.title} artist={f.artist} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Duplicates (same title + artist)" count={o.duplicates}>
        <ul className="flex flex-col gap-3">
          {o.duplicate_list.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words text-lg">{f.title} <span className="text-muted">· {f.artist}</span></p>
                <p className="break-words text-sm text-muted">{f.file_name}</p>
              </div>
              <ViewPdf id={f.id} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Changed in Dropbox since import" count={o.changed}>
        <ul className="flex flex-col gap-3">
          {o.changed_list.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words text-lg">{f.file_name}</p>
                <p className="text-sm text-muted">changed {when(f.changed_at)}</p>
              </div>
              <ViewPdf id={f.id} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Missing from Dropbox" count={o.missing}>
        <ul className="flex flex-col gap-2">
          {o.missing_list.map((f) => (
            <li key={f.id} className="break-words text-lg">
              {f.file_name} <span className="text-sm text-muted">{f.path}</span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
