import { Suspense } from "react";
import { AccountPlay } from "../../AccountSetlist";

export const metadata = { title: "Play · Broadway Book" };

export default function SetlistPlayPage({ params }: PageProps<"/setlists/[id]/play">) {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-bb-stage-black" />}>
      <Inner params={params} />
    </Suspense>
  );
}

async function Inner({ params }: { params: PageProps<"/setlists/[id]/play">["params"] }) {
  const { id } = await params;
  return <AccountPlay id={id} />;
}
