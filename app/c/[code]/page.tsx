import { Suspense } from "react";
import SharedChart from "./SharedChart";

export const metadata = { title: "Shared chart · Broadway Book", robots: { index: false, follow: false } };

/** View-only link to someone's uploaded chart: the structure card and chart, never audio. */
export default function SharedChartPage({ params }: PageProps<"/c/[code]">) {
  return (
    <Suspense fallback={<p className="p-4 text-lg text-bb-cue-gray">Loading…</p>}>
      <Inner params={params} />
    </Suspense>
  );
}

async function Inner({ params }: { params: PageProps<"/c/[code]">["params"] }) {
  const { code } = await params;
  return <SharedChart code={code} />;
}
