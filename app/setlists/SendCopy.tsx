"use client";

import { useEffect, useState } from "react";
import { OFFLINE_MSG, useOffline } from "@/lib/offline/status";
import { createInvite, inviteUrl, privateCount, revokeInvite, sentInvites, type SentInvite } from "@/lib/setlists/invites";
import { CopyButton } from "./AccountSetlist";
import { btn, localDay, plain } from "./ui";

const day = (iso: string | null) => localDay(iso) ?? "";

/** "Send a copy": an invite link for one player (7 days). They get their own copy to keep. */
export default function SendCopy({ id }: { id: string }) {
  const offline = useOffline();
  const [links, setLinks] = useState<SentInvite[]>([]);
  const [priv, setPriv] = useState(0);
  const [asking, setAsking] = useState(false); // private songs: confirm first
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () =>
    sentInvites(id)
      .then(setLinks)
      .catch(() => {});
  useEffect(() => {
    if (offline) return;
    let alive = true;
    void Promise.all([sentInvites(id), privateCount(id)])
      .then(([l, p]) => {
        if (!alive) return;
        setLinks(l);
        setPriv(p);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, offline]);

  const make = async () => {
    if (offline) return setErr(OFFLINE_MSG);
    setBusy(true);
    setErr(null);
    setAsking(false);
    try {
      setFresh(await createInvite(id));
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const off = async (inviteId: string) => {
    setBusy(true);
    setErr(null);
    try {
      await revokeInvite(inviteId);
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const line = (l: SentInvite) =>
    l.state === "used"
      ? `Accepted by ${l.accepted_name ?? "a player"} on ${day(l.accepted_at)}`
      : l.state === "off"
        ? "Turned off"
        : l.state === "expired"
          ? `Expired ${day(l.expires_at)}`
          : `Waiting · works until ${day(l.expires_at)}`;

  return (
    <section className="mb-6 border border-bb-rule-gray p-3">
      <h2 className="mb-1 text-lg font-semibold">Send a copy to a player</h2>
      <p className="mb-2 text-base text-bb-cue-gray">
        They get their own copy to keep and change (order, keys and notes). Each link works for one player, for 7 days.
      </p>
      {fresh && (
        <>
          <input readOnly value={inviteUrl(fresh)} onFocus={(e) => e.target.select()} aria-label="Invite link" className="bb-input mb-2 h-12 w-full px-3 text-base" />
          <div className="mb-2 flex flex-wrap gap-2">
            <CopyButton text={inviteUrl(fresh)} />
          </div>
        </>
      )}
      {asking ? (
        <div className="bb-notice mb-2" role="alert">
          <p className="mb-2 text-lg">
            {priv} song{priv === 1 ? " is" : "s are"} your private upload{priv === 1 ? "" : "s"}. They keep their place but show as “Private song, not shared”.
          </p>
          <div className="flex gap-2">
            <button disabled={busy} onClick={make} className={`${btn} ${plain} flex-1`}>
              Make link anyway
            </button>
            <button onClick={() => setAsking(false)} className={`${btn} ${plain} flex-1`}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button disabled={busy || offline} onClick={() => (priv > 0 ? setAsking(true) : make())} className={`${btn} ${plain}`}>
          {fresh ? "Make another link" : "Send a copy"}
        </button>
      )}
      {offline && <p className="mt-2 text-base text-bb-cue-gray">{OFFLINE_MSG}</p>}
      {err && <p className="bb-error mt-2 text-lg">{err}</p>}
      {links.length > 0 && (
        <ul className="mt-3 divide-y divide-bb-rule-gray border-y border-bb-rule-gray">
          {links.map((l) => (
            <li key={l.id} className="flex min-h-12 items-center gap-2 py-2">
              <span className="min-w-0 flex-1 text-base">
                <span className="block">{line(l)}</span>
                <span className="block text-sm text-bb-cue-gray">Made {day(l.created_at)}</span>
              </span>
              {l.state === "open" && (
                <button disabled={busy || offline} onClick={() => off(l.id)} className={`${btn} ${plain} shrink-0 text-base`}>
                  Turn off
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
