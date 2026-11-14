"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { OfflineNote } from "@/app/OfflineRoot";
import { useOffline } from "@/lib/offline/status";
import { useState, useTransition } from "react";
import { adminDecide, report, setBlocked, vote, withdrawProposal, type Result } from "../actions";
import { btn, when, ReviewerBadge } from "../ui";

export interface VoteRow {
  voter_id: string;
  value: "approve" | "reject";
  comment: string | null;
  created_at: string;
  voter: { display_name: string | null; reviewer?: boolean } | null;
}

interface Props {
  proposalId: string;
  songSlug: string;
  status: "open" | "approved" | "rejected" | "withdrawn";
  stale: boolean;
  authorId: string;
  authorBlocked: boolean;
  votes: VoteRow[];
  approvalsNeeded: number;
  rejectionsNeeded: number;
  me: { id: string; admin: boolean } | null;
}

const REASONS = [
  ["lyrics", "Contains lyrics"],
  ["wrong", "Wrong on purpose"],
  ["spam", "Spam"],
  ["abusive", "Rude or abusive"],
  ["other", "Something else"],
] as const;

export default function VotePanel(p: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [comment, setComment] = useState("");
  const [reporting, setReporting] = useState<{ voterId: string | null } | null>(null);
  const offline = useOffline();

  const counted = p.votes.filter((v) => v.voter_id !== p.authorId);
  const approvals = counted.filter((v) => v.value === "approve").length;
  const rejections = counted.length - approvals;
  const mine = p.me ? p.votes.find((v) => v.voter_id === p.me!.id) : undefined;
  const isAuthor = p.me?.id === p.authorId;
  const open = p.status === "open";
  const canVote = !!p.me && open && !p.stale && !isAuthor && !mine;

  const run = (fn: () => Promise<Result<object>>, okText: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error });
      if (r.ok) router.refresh();
    });
  };

  const castVote = (approve: boolean) =>
    start(async () => {
      const r = await vote({ id: p.proposalId, approve, comment });
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setComment("");
      setMsg({
        ok: true,
        text:
          r.status === "approved"
            ? "Your vote merged it. The chart is now live for everyone."
            : r.status === "rejected"
              ? "Your vote closed it."
              : "Thanks, your vote counts.",
      });
      router.refresh();
    });

  return (
    <section className="rounded-xl border border-bb-rule-gray p-4">
      <div className="mb-3 grid grid-cols-2 gap-3 text-center">
        <Meter label="Approve" n={approvals} of={p.approvalsNeeded} cls="bg-emerald-400" />
        <Meter label="Reject" n={rejections} of={p.rejectionsNeeded} cls="bg-red-400" />
      </div>

      {open && !p.me && (
        <Link href={`/login?next=${encodeURIComponent(`/community/${p.proposalId}`)}`} className={`${btn.primary} w-full`}>
          Sign in to vote
        </Link>
      )}
      {open && isAuthor && <p className="mb-3 text-lg text-bb-cue-gray">This is your suggestion, so you can&apos;t vote on it.</p>}
      {open && mine && (
        <p className="mb-3 text-lg">
          You voted <b>{mine.value === "approve" ? "Approve" : "Reject"}</b>.
        </p>
      )}

      {canVote && offline && <OfflineNote />}
      {canVote && !offline && (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-bb-cue-gray">Comment (optional)</span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={300}
              rows={2}
              className="rounded-xl border border-bb-rule-gray bg-bb-case-charcoal p-3 text-lg"
              placeholder="e.g. Yes, that's how the band plays it"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button disabled={pending} onClick={() => castVote(true)} className="min-h-14 rounded-xl bg-emerald-500 text-xl font-bold text-bb-stage-black active:opacity-80 disabled:opacity-40">
              ✓ Approve
            </button>
            <button disabled={pending} onClick={() => castVote(false)} className="min-h-14 rounded-xl bg-red-500 text-xl font-bold text-bb-stage-black active:opacity-80 disabled:opacity-40">
              ✕ Reject
            </button>
          </div>
        </div>
      )}

      {open && isAuthor && (
        <div className="mt-2 flex flex-wrap gap-3">
          <Link href={`/songs/${p.songSlug}/edit?proposal=${p.proposalId}`} className={p.stale ? btn.primary : btn.ghost}>
            {p.stale ? "Update to the newest chart" : "Edit suggestion"}
          </Link>
          <button
            disabled={pending}
            className={btn.ghost}
            onClick={() => run(() => withdrawProposal(p.proposalId), "Withdrawn.", "Withdraw this suggestion?")}
          >
            Withdraw
          </button>
        </div>
      )}

      {p.me?.admin && open && (
        <div className="mt-4 flex flex-wrap gap-3 border-t border-bb-rule-gray pt-4">
          <span className="w-full text-sm font-semibold uppercase tracking-wide text-bb-downbeat-amber">Admin</span>
          {!isAuthor && (
            <button
              disabled={pending || p.stale}
              className={btn.primary}
              onClick={() => run(() => adminDecide(p.proposalId, true), "Approved. The chart is live.", "Approve now and make this the live chart?")}
            >
              Approve now
            </button>
          )}
          <button
            disabled={pending}
            className={btn.danger}
            onClick={() => run(() => adminDecide(p.proposalId, false), "Closed.", "Close this suggestion without merging?")}
          >
            Close
          </button>
        </div>
      )}
      {p.me?.admin && !isAuthor && (
        <button
          disabled={pending}
          className={`${btn.link} mt-2 text-red-300`}
          onClick={() =>
            run(
              () => setBlocked(p.authorId, !p.authorBlocked),
              p.authorBlocked ? "Unblocked." : "Blocked. Their open suggestions were withdrawn.",
              p.authorBlocked ? "Unblock this player?" : "Block this player? They can still read charts but can't suggest, vote or report.",
            )
          }
        >
          {p.authorBlocked ? "Unblock author" : "Block author"}
        </button>
      )}

      {msg && (
        <p role="status" className={`mt-3 text-lg ${msg.ok ? "text-emerald-300" : "text-red-300"}`}>
          {msg.text}
        </p>
      )}

      {p.votes.length > 0 && (
        <ul className="mt-5 flex flex-col gap-2 border-t border-bb-rule-gray pt-4">
          {p.votes.map((v) => (
            <li key={v.voter_id} className="text-lg">
              <span className={v.value === "approve" ? "text-emerald-300" : "text-red-300"}>{v.value === "approve" ? "✓" : "✕"}</span>{" "}
              <b>{v.voter?.display_name || "A player"}</b>
              <ReviewerBadge on={v.voter?.reviewer} /> <span className="text-sm text-bb-cue-gray">{when(v.created_at)}</span>
              {v.comment && <p className="ml-5 text-bb-cue-gray">“{v.comment}”</p>}
              {v.comment && p.me && v.voter_id !== p.me.id && (
                <button className="ml-5 min-h-11 text-sm text-bb-cue-gray underline" onClick={() => setReporting({ voterId: v.voter_id })}>
                  Report comment
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {p.me && !isAuthor && (
        <button className="mt-4 min-h-11 text-base text-bb-cue-gray underline" onClick={() => setReporting({ voterId: null })}>
          Report this suggestion
        </button>
      )}

      {reporting && (
        <ReportForm
          onCancel={() => setReporting(null)}
          onSend={(reason, details) =>
            start(async () => {
              const r = await report({ proposalId: p.proposalId, voterId: reporting.voterId, reason, details });
              setReporting(null);
              setMsg(r.ok ? { ok: true, text: "Reported. An admin will take a look." } : { ok: false, text: r.error });
            })
          }
          pending={pending}
        />
      )}
    </section>
  );
}

function Meter({ label, n, of, cls }: { label: string; n: number; of: number; cls: string }) {
  return (
    <div>
      <p className="text-lg">
        <b className="text-2xl">{n}</b> / {of} {label.toLowerCase()}
      </p>
      <div className="mt-1 h-2 overflow-hidden rounded bg-bb-case-charcoal">
        <div className={`h-full ${cls}`} style={{ width: `${Math.min(100, (n / of) * 100)}%` }} />
      </div>
    </div>
  );
}

function ReportForm({ onSend, onCancel, pending }: { onSend: (reason: string, details: string) => void; onCancel: () => void; pending: boolean }) {
  const [reason, setReason] = useState<string>("lyrics");
  const [details, setDetails] = useState("");
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-xl border border-bb-rule-gray bg-bb-case-charcoal p-4">
      <p className="text-lg font-semibold">What&apos;s wrong?</p>
      <div className="flex flex-col gap-1">
        {REASONS.map(([value, label]) => (
          <label key={value} className="flex min-h-11 items-center gap-3 text-lg">
            <input type="radio" name="reason" value={value} checked={reason === value} onChange={() => setReason(value)} className="size-5" />
            {label}
          </label>
        ))}
      </div>
      <textarea
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        maxLength={300}
        rows={2}
        placeholder="Details (optional)"
        className="rounded-xl border border-bb-rule-gray bg-bb-house-black p-3 text-lg"
      />
      <div className="flex gap-3">
        <button disabled={pending} className={btn.primary} onClick={() => onSend(reason, details)}>
          Send report
        </button>
        <button className={btn.ghost} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
