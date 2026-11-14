import { Suspense } from "react";
import { SharedView } from "@/app/setlists/AccountSetlist";

export const metadata = { title: "Shared setlist · Broadway Book", robots: { index: false } };

/** View-only shared setlist (no sign-in). Readable only with its secret code. */
export default function SharedSetlistPage({ params }: PageProps<"/s/[code]">) {
  return (
    <Suspense fallback={<p className="p-4 text-lg text-bb-cue-gray">Loading…</p>}>
      <Inner params={params} />
    </Suspense>
  );
}

async function Inner({ params }: { params: PageProps<"/s/[code]">["params"] }) {
  const { code } = await params;
  return <SharedView code={code} />;
}
