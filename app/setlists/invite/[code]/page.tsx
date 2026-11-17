import { Suspense } from "react";
import { InvitePage } from "../../Invites";

export const metadata = { title: "Setlist invite · Broadway Book", robots: { index: false } };

/** An invite link: sign in, then Accept or Decline a copy of someone's setlist. */
export default function SetlistInvite({ params }: PageProps<"/setlists/invite/[code]">) {
  return (
    <Suspense fallback={<main className="mx-auto w-full max-w-xl px-4 pb-16 pt-14 text-xl">Loading…</main>}>
      <Invite params={params} />
    </Suspense>
  );
}

async function Invite({ params }: { params: PageProps<"/setlists/invite/[code]">["params"] }) {
  const { code } = await params;
  return <InvitePage code={code} />;
}
