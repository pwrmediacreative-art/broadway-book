import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/session";
import MineView from "../MineView";
import { loadMine } from "./data";

export const metadata = { title: "My chart · Broadway Book", robots: { index: false } };

export default function MinePage({ params }: PageProps<"/mine/[id]">) {
  return (
    <Suspense fallback={<p className="p-4 text-lg text-bb-cue-gray">Loading…</p>}>
      <Inner params={params} />
    </Suspense>
  );
}

async function Inner({ params }: { params: PageProps<"/mine/[id]">["params"] }) {
  const { id } = await params;
  if (!(await getCurrentUser())) redirect(`/login?next=${encodeURIComponent(`/mine/${id}`)}`);
  const chart = await loadMine(id);
  if (!chart) notFound();
  return <MineView chart={chart} />;
}
