"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { OfflineNote } from "@/app/OfflineRoot";
import { useOffline } from "@/lib/offline/status";
import { acceptInvite, declineInvite, INVITES_EVENT, openInvite, waitingInvites, type InviteCardData } from "@/lib/setlists/invites";
import { browserClient } from "@/lib/supabase/browser";
import { btn, localDay, plain, primary } from "./ui";

const shortDate = (iso?: string | null) => localDay(iso);

/** "Pat sent you a setlist": name, sender, song count, Accept / Decline. */
export function InviteCard({ invite, onDone }: { invite: InviteCardData; onDone?: () => void }) {
  const router = useRouter();
  const offline = useOffline();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const act = async (accept: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      if (accept) {
        const id = await acceptInvite(invite.code);
        window.dispatchEvent(new Event(INVITES_EVENT));
        router.push(`/setlists/${id}`);
      } else {
        await declineInvite(invite.code);
        window.dispatchEvent(new Event(INVITES_EVENT));
        onDone?.();
      }
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <section className="bb-notice mb-4" aria-label={`Setlist from ${invite.sender}`}>
      <p className="text-base text-bb-cue-gray">{invite.sender} sent you a copy of a setlist</p>
      <h2 className="text-2xl font-bold">{invite.name}</h2>
      <p className="mb-3 text-lg text-bb-cue-gray">
        {invite.count} song{invite.count === 1 ? "" : "s"}
        {invite.expires_at ? ` · link works until ${shortDate(invite.expires_at)}` : ""}
      </p>
      {offline ? (
        <OfflineNote />
      ) : (
        <div className="flex gap-2">
          <button disabled={busy} onClick={() => act(true)} className={`${btn} ${primary} h-14 flex-1 text-xl`}>
            Accept
          </button>
          <button disabled={busy} onClick={() => act(false)} className={`${btn} ${plain} h-14 flex-1 text-xl`}>
            Decline
          </button>
        </div>
      )}
      <p className="mt-2 text-base text-bb-cue-gray">Accept adds your own copy. Changes on either side never affect the other.</p>
      {err && <p className="bb-error mt-2 text-lg">{err}</p>}
    </section>
  );
}

/** /setlists: every invite this player opened but hasn't answered. */
export function WaitingInvites() {
  const [list, setList] = useState<InviteCardData[]>([]);
  const offline = useOffline();
  useEffect(() => {
    if (offline) return;
    let alive = true;
    const load = () =>
      waitingInvites()
        .then((l) => alive && setList(l))
        .catch(() => {});
    load();
    window.addEventListener(INVITES_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(INVITES_EVENT, load);
    };
  }, [offline]);
  return (
    <>
      {list.map((i) => (
        <InviteCard key={i.code} invite={i} onDone={() => setList((l) => l.filter((x) => x.code !== i.code))} />
      ))}
    </>
  );
}

/** The page an invite link opens. */
export function InvitePage({ code }: { code: string }) {
  const [card, setCard] = useState<InviteCardData | "out" | "loading" | { error: string }>("loading");
  const offline = useOffline();
  useEffect(() => {
    if (offline) return;
    let alive = true;
    (async () => {
      const { data } = await browserClient().auth.getSession();
      if (!data.session) return alive && setCard("out");
      try {
        const c = await openInvite(code);
        if (alive) setCard(c);
      } catch (e) {
        if (alive) setCard({ error: (e as Error).message });
      }
    })();
    return () => {
      alive = false;
    };
  }, [code, offline]);

  const back = (
    <Link href="/setlists" className="inline-flex h-12 items-center text-lg text-bb-cue-gray active:text-bb-chart-white">
      ← Setlists
    </Link>
  );
  const msg = (text: string) => <p className="mt-4 text-xl">{text}</p>;
  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-16 pt-2">
      {back}
      {offline ? (
        <OfflineNote />
      ) : card === "loading" ? (
        msg("Loading…")
      ) : card === "out" ? (
        <section className="bb-notice mt-4">
          <h1 className="mb-2 text-2xl font-bold">Someone sent you a setlist</h1>
          <p className="mb-3 text-lg">Sign in to see it and add your own copy.</p>
          <Link href={`/login?next=${encodeURIComponent(`/setlists/invite/${code}`)}`} className={`${btn} ${primary} h-14 w-full text-xl`}>
            Sign in
          </Link>
        </section>
      ) : "error" in card ? (
        msg(`Couldn't open this link: ${card.error}`)
      ) : card.state === "open" ? (
        <div className="mt-4">
          <InviteCard invite={card} onDone={() => setCard({ ...card, state: "missing" })} />
        </div>
      ) : card.state === "accepted" && card.copy_id ? (
        <p className="mt-4 text-xl">
          You already added this setlist.{" "}
          <Link href={`/setlists/${card.copy_id}`} className="underline">
            Open your copy
          </Link>
        </p>
      ) : card.state === "yours" ? (
        msg("This is your own link. Send it to the player you want to have a copy.")
      ) : card.state === "used" ? (
        msg("This link was already used. Ask the sender for a new one.")
      ) : card.state === "off" ? (
        msg("The sender turned this link off.")
      ) : card.state === "expired" ? (
        msg("This link has expired. Ask the sender for a new one.")
      ) : (
        msg("Nothing to accept here. The link is incomplete, or you declined it.")
      )}
    </main>
  );
}
