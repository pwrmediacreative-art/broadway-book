import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, sessionClient, syncPro, syncRole } from "@/lib/supabase/session";
import UploadForm from "./UploadForm";

export const metadata = { title: "Upload · Broadway Book", robots: { index: false } };

export default function UploadPage() {
  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-16 pt-2">
      <Suspense fallback={<p className="text-lg text-bb-cue-gray">Loading…</p>}>
        <Upload />
      </Suspense>
    </main>
  );
}

interface Mine {
  id: string;
  title: string;
  artist: string | null;
  key: string | null;
  has_audio: boolean;
  confidence: number | null;
  created_at: string;
}

async function Upload() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=%2Fupload");
  await syncRole(user.id, user.email, user.role);
  await syncPro(user.id, user.email);
  const db = await sessionClient();
  // The database decides (setting + role + Pro). Everyone else never sees this page.
  const { data: allowed } = await db.rpc("upload_access");
  if (!allowed) notFound();
  const { data } = await db.rpc("my_private_charts");
  const mine = (data as Mine[] | null) ?? [];
  const maxMb = Number(process.env.MAX_AUDIO_MB) > 0 ? Number(process.env.MAX_AUDIO_MB) : 50;

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">Upload a chart</h1>
      <p className="mb-5 mt-1 text-lg text-bb-cue-gray">
        A Moises chord chart (.musicxml) becomes a private chart you can edit, play in any key, use on stage and add to setlists.
      </p>
      <UploadForm maxMb={maxMb} />
      <h2 className="mb-2 mt-10 text-2xl font-bold">My uploads</h2>
      {mine.length === 0 ? (
        <p className="text-lg text-bb-cue-gray">Nothing yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {mine.map((m) => (
            <li key={m.id} className="bb-panel flex items-stretch">
              <Link href={`/upload/${m.id}`} className="flex min-h-14 min-w-0 flex-1 flex-col justify-center px-4 py-2 active:bg-bb-rule-gray">
                <span className="truncate text-lg font-semibold">{m.title}</span>
                <span className="truncate text-base text-bb-cue-gray">
                  {[m.artist, m.key, m.has_audio ? "audio" : null, m.confidence !== null ? `${Math.round(m.confidence * 100)}% sure (estimated)` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </Link>
              <Link
                href={`/mine/${m.id}/stage`}
                aria-label={`Stage mode: ${m.title}`}
                className="flex w-20 shrink-0 items-center justify-center border-l border-bb-rule-gray text-base font-semibold text-bb-cue-gray active:bg-bb-rule-gray"
              >
                Stage
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
