import { Suspense } from "react";
import { SharedPlay } from "@/app/setlists/AccountSetlist";

export const metadata = { title: "Play · Broadway Book", robots: { index: false } };

export default function SharedPlayPage({ params }: PageProps<"/s/[code]/play">) {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-black" />}>
      <Inner params={params} />
    </Suspense>
  );
}

async function Inner({ params }: { params: PageProps<"/s/[code]/play">["params"] }) {
  const { code } = await params;
  return <SharedPlay code={code} />;
}
