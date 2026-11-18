import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/session";
import NewChartForm from "./NewChartForm";

export const metadata = { title: "New chart · Broadway Book", robots: { index: false } };

export default function NewChartPage({ searchParams }: PageProps<"/make">) {
  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-16 pt-2">
      <Link href="/" className="inline-flex h-12 items-center text-lg text-bb-cue-gray active:text-bb-chart-white">
        ← Home
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">New chart</h1>
      <p className="mb-5 mt-1 text-lg text-bb-cue-gray">Only you can see it until you send it to the library.</p>
      <Suspense fallback={<p className="text-lg text-bb-cue-gray">Loading…</p>}>
        <Inner searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Inner({ searchParams }: { searchParams: PageProps<"/make">["searchParams"] }) {
  const sp = await searchParams;
  const setlist = typeof sp.setlist === "string" && /^[0-9a-f-]{36}$/.test(sp.setlist) ? sp.setlist : null;
  if (!(await getCurrentUser())) redirect(`/login?next=${encodeURIComponent(setlist ? `/make?setlist=${setlist}` : "/make")}`);
  return <NewChartForm setlist={setlist} />;
}
