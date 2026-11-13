import { Suspense } from "react";
import { AccountEditor } from "../AccountSetlist";

export const metadata = { title: "Setlist · Broadway Book" };

export default function SetlistPage({ params }: PageProps<"/setlists/[id]">) {
  return (
    <Suspense fallback={<p className="p-4 text-lg text-muted">Loading…</p>}>
      <Inner params={params} />
    </Suspense>
  );
}

async function Inner({ params }: { params: PageProps<"/setlists/[id]">["params"] }) {
  const { id } = await params;
  return <AccountEditor id={id} />;
}
