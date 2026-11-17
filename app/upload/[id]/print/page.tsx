import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { loadMine } from "@/app/mine/[id]/data";
import { getCurrentUser } from "@/lib/supabase/session";
import PrintView from "./PrintView";

export const metadata = { title: "Song details · Broadway Book", robots: { index: false } };

/** One page to print or screenshot: key, BPM and form on top, then watch-outs and the chart. */
export default function PrintPage({ params }: PageProps<"/upload/[id]/print">) {
  return (
    <Suspense fallback={null}>
      <Inner params={params} />
    </Suspense>
  );
}

async function Inner({ params }: { params: PageProps<"/upload/[id]/print">["params"] }) {
  const { id } = await params;
  if (!(await getCurrentUser())) redirect(`/login?next=${encodeURIComponent(`/upload/${id}/print`)}`);
  const chart = await loadMine(id);
  if (!chart) notFound();
  return <PrintView chart={chart} />;
}
