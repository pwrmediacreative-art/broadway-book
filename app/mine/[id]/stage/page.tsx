import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import StageView from "@/app/songs/[slug]/StageView";
import { getCurrentUser } from "@/lib/supabase/session";
import { loadMine } from "../data";

export const metadata = { title: "Stage · Broadway Book", robots: { index: false } };

const NO_NEIGHBORS = { prev: null, next: null };

export default function MineStagePage({ params }: PageProps<"/mine/[id]/stage">) {
  return (
    <Suspense fallback={null}>
      <Inner params={params} />
    </Suspense>
  );
}

async function Inner({ params }: { params: PageProps<"/mine/[id]/stage">["params"] }) {
  const { id } = await params;
  if (!(await getCurrentUser())) redirect(`/login?next=${encodeURIComponent(`/mine/${id}/stage`)}`);
  const chart = await loadMine(id);
  if (!chart) notFound();
  return <StageView slug={chart.slug} title={chart.title} chartText={chart.chart_text} neighbors={NO_NEIGHBORS} mine={{ id: chart.id }} />;
}
