"use client";

// Edit from the Full song pop-up (Q17): the tap-to-build editor (Q16, app/make/[id]/Builder)
// on the chart being shown, with today's save rules. Your own charts (made or uploaded) save
// straight to the chart. A library chart gives the same two choices as /songs/[slug]/edit:
// "Just for me" (your own version, no vote) or "Suggest for everyone" (live after the
// community approves it; admins decide on the suggestion page as today). Same server actions,
// same database rules.
import { useMemo, useState, useTransition } from "react";
import Builder from "@/app/make/[id]/Builder";
import { saveChart } from "@/app/make/actions";
import { propose, savePersonal } from "@/app/community/actions";
import { savePrivateChart } from "@/app/upload/actions";
import { OfflineNote } from "@/app/OfflineRoot";
import { checkChart, diffDocs, parseChart } from "@/lib/chart";
import { fromText } from "@/lib/make/model";
import { useNavMe } from "@/lib/nav/me";
import { useOffline } from "@/lib/offline/status";
import { loadMyVersions } from "@/lib/personal/versions";
import { PREF, setPref } from "@/lib/prefs";

export type EditTarget =
  | { kind: "library"; songId: string; revisionId: string | null } // a published song
  | { kind: "made"; id: string } // your chart made in the tap-to-build editor
  | { kind: "upload"; songId: string }; // your uploaded chart

/** Edit shows only for signed-in players, and only where there is somewhere to save. */
export function useCanEdit(target?: EditTarget): boolean {
  const me = useNavMe();
  return !!target && !!me;
}

export default function FullEdit({
  target,
  slug,
  text,
  publicText,
  onClose,
  onSaved,
}: {
  target: EditTarget;
  slug: string;
  /** The chart being shown (for a library song: your own version when you're viewing it). */
  text: string;
  /** The library chart everyone sees (what a suggestion is compared with). */
  publicText: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const bad = useMemo(() => {
    try {
      fromText(text);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, [text]);
  return (
    <div role="dialog" aria-label="Edit chart" className="fixed inset-0 z-[60] overflow-y-auto overscroll-contain bg-bb-house-black text-bb-chart-white">
      {bad ? (
        <div className="mx-auto max-w-3xl px-4 pt-2">
          <button type="button" onClick={onClose} className="inline-flex h-12 items-center text-lg text-bb-cue-gray active:text-bb-chart-white">
            ← Full song
          </button>
          <p className="bb-error mt-3 px-3 py-2 text-lg">This chart can&apos;t open in the editor: {bad}</p>
        </div>
      ) : (
        <Builder
          id={target.kind === "made" ? target.id : ""}
          slug={slug}
          initialText={text}
          locked={false}
          proposalId={null}
          setlist={null}
          setlistError={false}
          popup={{
            onClose,
            save: (t, changed) => <SaveChoices target={target} slug={slug} text={t} changed={changed} publicText={publicText} onSaved={onSaved} />,
          }}
        />
      )}
    </div>
  );
}

type Msg = { text: string } | null;

function SaveChoices({
  target,
  slug,
  text,
  changed,
  publicText,
  onSaved,
}: {
  target: EditTarget;
  slug: string;
  text: string;
  changed: boolean;
  publicText: string;
  onSaved: (message: string) => void;
}) {
  const offline = useOffline();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [note, setNote] = useState("");
  const [noteMissing, setNoteMissing] = useState(false);
  const check = useMemo(() => checkChart(text), [text]);
  const publicDoc = useMemo(() => {
    try {
      return parseChart(publicText).doc;
    } catch {
      return null;
    }
  }, [publicText]);
  const unchanged = useMemo(() => !!check.doc && !!publicDoc && diffDocs(publicDoc, check.doc).changedRows === 0, [check.doc, publicDoc]);
  const blocked = pending || !check.ok || offline;

  const run = (f: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) =>
    start(async () => {
      setMsg(null);
      try {
        const r = await f();
        if (!r.ok) return setMsg({ text: r.error });
        onSaved(done);
      } catch {
        setMsg({ text: "Couldn't save. Check your connection." });
      }
    });

  const problem = check.error ? `Format error: ${check.error}` : check.longCues.length ? `Cue too long (6 words max, never lyrics): “${check.longCues[0]}”` : null;

  if (target.kind !== "library") {
    return (
      <div className="flex flex-col gap-3">
        {problem && <p className="bb-error px-3 py-2 text-lg">{problem}</p>}
        {msg && <p role="status" className="bb-error px-3 py-2 text-lg">{msg.text}</p>}
        {offline && <OfflineNote />}
        <SaveButton
          primary
          title="Save"
          sub={changed ? "Saves to your chart." : "Change something first."}
          disabled={blocked || !changed}
          onClick={() =>
            run(
              () => (target.kind === "made" ? saveChart(target.id, text) : savePrivateChart(target.songId, text)),
              "Saved.",
            )
          }
        />
      </div>
    );
  }

  const saveMine = () =>
    run(async () => {
      const r = await savePersonal({ songId: target.songId, chartText: text, note, basedOn: target.revisionId });
      if (r.ok) {
        await loadMyVersions();
        setPref(PREF.showPublic(slug), null, "session"); // show the version just saved
      }
      return r;
    }, "Saved just for you.");

  const suggest = () => {
    if (note.trim().length < 3) {
      setNoteMissing(true);
      setMsg({ text: "Add a short note so voters know what you changed." });
      document.getElementById("full-edit-note")?.focus();
      return;
    }
    run(
      () => propose({ songId: target.songId, chartText: text, note, baseRevisionId: target.revisionId }),
      "Suggestion sent. Everyone will see it after 3 players approve.",
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-lg font-semibold">
          Note <span className="font-normal text-bb-cue-gray">(required for everyone, optional just for you)</span>
        </span>
        <input
          id="full-edit-note"
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setNoteMissing(false);
          }}
          maxLength={500}
          placeholder="e.g. Bridge goes to the 6-, not the 4"
          aria-invalid={noteMissing}
          className={`bb-input min-h-12 px-4 text-lg ${noteMissing ? "border-bb-stop-red" : ""}`}
        />
      </label>
      {problem && <p className="bb-error px-3 py-2 text-lg">{problem}</p>}
      {msg && (
        <p role="status" className="bb-error px-3 py-2 text-lg">
          {msg.text}
        </p>
      )}
      {offline && <OfflineNote />}
      <div className="grid gap-3 sm:grid-cols-2">
        <SaveButton
          primary
          title="Just for me"
          sub={changed ? "Only you will see this. Saved to your account, no vote." : "Change something first."}
          disabled={blocked || !changed}
          onClick={saveMine}
        />
        <SaveButton
          title="Suggest for everyone"
          sub={unchanged ? "Change something first." : "Everyone will see it after 3 players approve."}
          disabled={blocked || unchanged}
          onClick={suggest}
        />
      </div>
    </div>
  );
}

function SaveButton({ onClick, disabled, title, sub, primary }: { onClick: () => void; disabled: boolean; title: string; sub: string; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-20 w-full flex-col items-start justify-center rounded-bb-control border px-5 py-3 text-left ${primary ? "bb-btn-primary" : "bb-btn-secondary"}`}
    >
      <span className="text-xl font-bold">{title}</span>
      <span className={`text-base ${primary ? "font-normal" : "text-bb-cue-gray"}`}>{sub}</span>
    </button>
  );
}
