import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { chartFolder, dropboxConfigured } from "@/lib/dropbox/client";
import { aiConfigured, spendCap } from "@/lib/ai/reader";
import { getCurrentUser, sessionClient, syncRole } from "@/lib/supabase/session";
import { AiPanel, type AiSummary } from "./AiPanel";
import { AutoApprove, type AutoOverview } from "./AutoApprove";
import { FixNameForm, ScanButton } from "./forms";
import { PilotResults, type PilotItem } from "./PilotResults";

export const metadata = { title: "Import · Broadway Book", robots: { index: false } };
// The AI pilot and batch steps run as Server Actions on this page.
export const maxDuration = 300;

type SearchParams = Promise<{ q?: string | string[] }>;

export default function ImportPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-2">
      <Suspense fallback={<p className="text-lg text-bb-cue-gray">Loading…</p>}>
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
interface AiOverview {
  spent: number;
  reserved: number;
  counts: Record<string, number>;
  batch_avg: number | null;
  pilot_avg: number | null;
  remaining: number;
  unnamed: number;
  open_batches: string[];
  pilot_approved_at: string | null;
  pilot: PilotItem[];
  skipped: { already_read: number; duplicates: number; unnamed: number };
  batch: { total: number; read: number; failed: number; open: number; cost: number };
  first_chunk_ok_at: string | null;
  retryable: number;
  queued: number;
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
      className="bb-btn bb-btn-secondary shrink-0 px-3"
    >
      View PDF
    </a>
  );
}

function Section({ title, count, open, children }: { title: string; count: number; open?: boolean; children: ReactNode }) {
  return (
    <details open={open} className="bb-panel mb-4 border border-bb-rule-gray">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-3 text-xl font-semibold">
        <span>{title}</span>
        <span className="tabular-nums text-bb-cue-gray">{count}</span>
      </summary>
      <div className="border-t border-bb-rule-gray px-4 py-3">{count === 0 ? <p className="text-bb-cue-gray">None.</p> : children}</div>
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
  const [{ data: aiData }, { data: auto }] = await Promise.all([db.rpc("ai_overview"), db.rpc("auto_approve_overview")]);
  const ai = aiData as AiOverview | null;
  const c = ai?.counts ?? {};
  const n = (k: string) => Number(c[k] ?? 0);
  const cap = spendCap();
  const aiSummary: AiSummary = {
    configured: connected && aiConfigured() && cap > 0,
    cap,
    spent: Number(ai?.spent ?? 0),
    reserved: Number(ai?.reserved ?? 0),
    done: n("ok") + n("ok_after_retry"),
    needsManual: n("needs_manual"),
    failed: n("error") + n("refused"),
    processing: n("reserved") + n("submitted"),
    remaining: Number(ai?.remaining ?? 0),
    unnamed: Number(ai?.unnamed ?? 0),
    openBatches: ai?.open_batches.length ?? 0,
    pilotCount: ai?.pilot.length ?? 0,
    pilotApproved: Boolean(ai?.pilot_approved_at),
    // Batch is half the standard price; before any batch result, use half the pilot average.
    estPerSong: Number(ai?.batch_avg ?? (ai?.pilot_avg != null ? Number(ai.pilot_avg) / 2 : 0.0275)),
    skipped: {
      alreadyRead: Number(ai?.skipped.already_read ?? 0),
      duplicates: Number(ai?.skipped.duplicates ?? 0),
      unnamed: Number(ai?.skipped.unnamed ?? 0),
    },
    batch: {
      total: Number(ai?.batch.total ?? 0),
      read: Number(ai?.batch.read ?? 0),
      failed: Number(ai?.batch.failed ?? 0),
      open: Number(ai?.batch.open ?? 0),
      cost: Number(ai?.batch.cost ?? 0),
    },
    batchAuto: Number((auto as { batch_auto?: number } | null)?.batch_auto ?? 0),
    pilotCost: (ai?.pilot ?? []).reduce((sum, p) => sum + Number(p.cost_usd ?? 0), 0),
    firstChunkPending: !ai?.first_chunk_ok_at && Number(ai?.batch.total ?? 0) > 0,
    retryable: Number(ai?.retryable ?? 0),
    queued: Number(ai?.queued ?? 0),
  };

  return (
    <>
    <div className="mx-auto max-w-2xl">
      <Link href="/admin" className="inline-flex h-12 items-center text-lg text-bb-cue-gray active:text-bb-chart-white">
        ← Admin
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">Import from Dropbox</h1>
      <p className="mb-4 mt-1 text-lg text-bb-cue-gray">
        Folder <span className="text-bb-chart-white">{chartFolder()}</span> · last scan {when(o.last_scan)}
      </p>

      {!connected && (
        <p className="bb-notice mb-4">
          <b>Dropbox isn&apos;t connected yet:</b> set DROPBOX_APP_KEY, DROPBOX_APP_SECRET and DROPBOX_REFRESH_TOKEN.
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
          <div key={label} className="bb-panel p-4">
            <dt className="text-sm text-bb-cue-gray">{label}</dt>
            <dd className="text-3xl font-bold tabular-nums">{n}</dd>
          </div>
        ))}
      </dl>
      <p className="mb-6 text-lg tabular-nums text-bb-cue-gray">
        {o.duplicate_groups} duplicate groups · {o.changed} changed since import · {o.missing} missing from Dropbox
      </p>

      {ai && <AiPanel s={aiSummary} />}
      {auto && <AutoApprove o={auto as AutoOverview} />}
    </div>

    {ai && <PilotResults items={ai.pilot} avgCost={ai.pilot_avg} />}

    <div className="mx-auto max-w-2xl">

      <form method="get" className="mb-6 flex gap-2" role="search">
        <label htmlFor="q" className="sr-only">Search files</label>
        <input
          id="q"
          name="q"
          defaultValue={q}
          placeholder="Search filenames"
          className="bb-input w-full"
        />
        <button type="submit" className="bb-btn bb-btn-secondary px-5">
          Search
        </button>
      </form>
      {q && (
        <Section title={`Results for “${q}”`} count={results.length} open>
          <ul className="flex flex-col gap-3">
            {results.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-lg">{r.title ?? "—"} <span className="text-bb-cue-gray">· {r.artist ?? "no artist"}</span></p>
                  <p className="break-words text-sm text-bb-cue-gray">{r.file_name}{r.missing ? " · missing" : ""}</p>
                </div>
                <ViewPdf id={r.id} />
              </li>
            ))}
          </ul>
          {results.length === 50 && <p className="mt-3 text-bb-cue-gray">Showing the first 50.</p>}
        </Section>
      )}

      <Section title="Unparsed names" count={o.unparsed} open>
        <p className="mb-3 text-bb-cue-gray">No artist in the filename. Set both; saving creates the draft song.</p>
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
                <p className="break-words text-lg">{f.title} <span className="text-bb-cue-gray">· {f.artist}</span></p>
                <p className="break-words text-sm text-bb-cue-gray">{f.file_name}</p>
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
                <p className="text-sm text-bb-cue-gray">changed {when(f.changed_at)}</p>
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
              {f.file_name} <span className="text-sm text-bb-cue-gray">{f.path}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
    </>
  );
}
