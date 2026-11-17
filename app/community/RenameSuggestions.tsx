"use client";

// Open name suggestions on /community: vote, or (admins) decide now, or (author) withdraw.
// The rules live in the database (20261118100000_song_rename.sql); this only calls them.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { OfflineNote } from "@/app/OfflineRoot";
import { useOffline } from "@/lib/offline/status";
import { adminDecideRename, voteRename, withdrawRename, type RenameResult } from "@/app/songs/[slug]/rename-actions";
import { btn, when, ReviewerBadge } from "./ui";
import { renameStale, songName, type RenameRow } from "./rename";

interface Props {
  rows: RenameRow[];
  me: { id: string; admin: boolean } | null;
  approvalsNeeded: number;
  loginHref: string;
}

export default function RenameSuggestions({ rows, me, approvalsNeeded, loginHref }: Props) {
  return (
    <ul className="divide-y divide-bb-rule-gray border-y border-bb-rule-gray">
      {rows.map((r) => (
        <Item key={r.id} r={r} me={me} approvalsNeeded={approvalsNeeded} loginHref={loginHref} />
      ))}
    </ul>
  );
}

type Ask = "withdraw" | "approve" | "close";
const ASK: Record<Ask, [string, string]> = {
  withdraw: ["Withdraw this name suggestion?", "Yes, withdraw"],
  approve: ["Rename the song now for everyone?", "Yes, rename"],
  close: ["Close this suggestion without renaming?", "Yes, close"],
};

function Item({ r, me, approvalsNeeded, loginHref }: { r: RenameRow; me: Props["me"]; approvalsNeeded: number; loginHref: string }) {
  const router = useRouter();
  const offline = useOffline();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const saved = me ? r.votes.find((v) => v.voter_id === me.id)?.value : undefined;
  const [picked, setPicked] = useState<"approve" | "reject" | undefined>(saved);

  const isAuthor = me?.id === r.author_id;
  const stale = renameStale(r);
  // Counts as the database counts them: the author's own vote never counts.
  const counted = r.votes.filter((v) => v.voter_id !== r.author_id && v.voter_id !== me?.id);
  const myVote = me && !isAuthor ? picked : undefined;
  const yes = counted.filter((v) => v.value === "approve").length + (myVote === "approve" ? 1 : 0);
  const no = counted.filter((v) => v.value === "reject").length + (myVote === "reject" ? 1 : 0);

  const castVote = (approve: boolean) => {
    if (picked === (approve ? "approve" : "reject")) return; // already their vote
    setAsk(null);
    start(async () => {
      const r2 = await voteRename(r.id, approve);
      if (!r2.ok) return setMsg({ ok: false, text: r2.error });
      setPicked(approve ? "approve" : "reject");
      setMsg({
        ok: true,
        text:
          r2.status === "approved"
            ? "Your vote renamed the song for everyone."
            : r2.status === "rejected"
              ? "Your vote closed it."
              : "Thanks, your vote counts.",
      });
      router.refresh();
    });
  };

  const decide = (which: Ask) => {
    setAsk(null);
    const [fn, okText]: [() => Promise<RenameResult>, string] =
      which === "withdraw"
        ? [() => withdrawRename(r.id), "Withdrawn."]
        : which === "approve"
          ? [() => adminDecideRename(r.id, true), "Renamed."]
          : [() => adminDecideRename(r.id, false), "Closed."];
    start(async () => {
      const r2 = await fn();
      setMsg(r2.ok ? { ok: true, text: okText } : { ok: false, text: r2.error });
      if (r2.ok) router.refresh();
    });
  };

  const canVote = !!me && !isAuthor && !stale;

  return (
    <li className="px-1 py-4">
      <Link href={`/songs/${r.song.slug}`} className="block break-words text-xl font-semibold active:text-bb-cue-gray">
        {songName(r.song.title, r.song.artist)}
      </Link>
      <p className="mt-1 break-words text-lg">
        <span className="text-bb-cue-gray">Rename to </span>
        <b>“{songName(r.new_title, r.new_artist)}”</b>
      </p>
      {r.note && <p className="mt-2 text-lg">“{r.note}”</p>}
      <p className="mt-1 text-sm text-bb-cue-gray">
        {r.author?.display_name || "A player"}
        <ReviewerBadge on={r.author?.reviewer} /> · {when(r.created_at)} · <span className="text-bb-chart-white">✓ {yes}</span>{" "}
        <span>✕ {no}</span> · needs {approvalsNeeded} approvals
      </p>

      {stale && (
        <p className="bb-notice mt-3">
          <b>Out of date:</b> The song was renamed after this was suggested, so voting is closed.
        </p>
      )}

      {!me && (
        <Link href={loginHref} className={`${btn.link} mt-1`}>
          Sign in to vote
        </Link>
      )}
      {isAuthor && <p className="mt-2 text-lg text-bb-cue-gray">This is your suggestion, so you can&apos;t vote on it.</p>}

      {(canVote || isAuthor || me?.admin) && offline && <OfflineNote className="mt-3" />}

      {canVote && !offline && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <button
            disabled={pending}
            aria-pressed={picked === "approve"}
            onClick={() => castVote(true)}
            className={`bb-btn bb-btn-secondary min-h-12 text-lg ${picked === "approve" ? "bb-on" : ""}`}
          >
            ✓ Approve
          </button>
          <button
            disabled={pending}
            aria-pressed={picked === "reject"}
            onClick={() => castVote(false)}
            className={`bb-btn bb-btn-secondary min-h-12 text-lg ${picked === "reject" ? "bb-on" : ""}`}
          >
            ✕ Reject
          </button>
        </div>
      )}
      {canVote && picked && (
        <p className="mt-2 text-sm text-bb-cue-gray">
          You picked {picked === "approve" ? "Approve" : "Reject"}. Tap the other one to change it.
        </p>
      )}

      {!offline && (isAuthor || me?.admin) && !ask && (
        <div className="mt-3 flex flex-wrap gap-3">
          {me?.admin && !isAuthor && !stale && (
            <button disabled={pending} className={btn.ghost} onClick={() => setAsk("approve")}>
              Approve now
            </button>
          )}
          {me?.admin && (
            <button disabled={pending} className={btn.danger} onClick={() => setAsk("close")}>
              Close
            </button>
          )}
          {isAuthor && (
            <button disabled={pending} className={btn.ghost} onClick={() => setAsk("withdraw")}>
              Withdraw
            </button>
          )}
        </div>
      )}
      {!offline && ask && (
        <div className="bb-panel mt-3 flex flex-col gap-3 p-4">
          <p className="text-lg font-semibold">{ASK[ask][0]}</p>
          <div className="flex flex-wrap gap-3">
            <button disabled={pending} className={ask === "close" ? btn.danger : btn.ghost} onClick={() => decide(ask)}>
              {ASK[ask][1]}
            </button>
            <button disabled={pending} className={btn.ghost} onClick={() => setAsk(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {msg && (
        <p role="status" className={`mt-3 text-lg ${msg.ok ? "text-bb-chart-white" : "bb-error"}`}>
          {msg.ok ? `✓ ${msg.text}` : msg.text}
        </p>
      )}
    </li>
  );
}
