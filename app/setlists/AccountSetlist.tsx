"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { deleteSetlist, loadSetlist, loadSharedSetlist, saveSetlist, shareSetlist, type AccountSet } from "@/lib/setlists/api";
import type { PlaySet } from "@/lib/setlists/play";
import Editor from "./Editor";
import PlayView from "./PlayView";
import SavedSet from "./SavedSet";
import { isOffline, OFFLINE_MSG } from "@/lib/offline/status";
import { btn, enterFullscreen, gigDate, plain, primary, SetSongList } from "./ui";

type Load = { state: "loading" } | { state: "missing" } | { state: "error"; message: string } | { state: "ok"; set: AccountSet };

/** One request: the setlist and every chart in it (by id for the owner, by share code for anyone). */
function useSet(by: { id: string } | { code: string }): Load {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const k = "id" in by ? `i:${by.id}` : `c:${by.code}`;
  useEffect(() => {
    let alive = true;
    ("id" in by ? loadSetlist(by.id) : loadSharedSetlist(by.code))
      .then((set) => alive && setLoad(set ? { state: "ok", set } : { state: "missing" }))
      .catch((e: Error) => alive && setLoad({ state: "error", message: e.message }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k]);
  return load;
}

function Status({ load, missing }: { load: Load; missing: string }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-2">
      <Link href="/setlists" className="inline-flex h-12 items-center text-lg text-bb-cue-gray active:text-bb-chart-white">
        ← Setlists
      </Link>
      <p className="mt-4 text-xl">{load.state === "loading" ? "Loading…" : load.state === "error" ? `Couldn't load: ${load.message}` : missing}</p>
    </main>
  );
}

const NOT_YOURS = "Setlist not found. It may have been deleted, or it belongs to another account (sign in as its owner).";
const LINK_OFF = "This setlist link was turned off, or it doesn't exist. Ask for a new link.";

export function AccountEditor({ id }: { id: string }) {
  const load = useSet({ id });
  const save = useCallback(
    async (s: PlaySet) => {
      if (isOffline()) throw new Error(OFFLINE_MSG);
      await saveSetlist(id, s);
    },
    [id],
  );
  if (load.state !== "ok") return <Status load={load} missing={NOT_YOURS} />;
  // Opened offline from the phone's saved copy: view and play only.
  if (load.set.saved) return <SavedSet set={load.set} id={id} />;
  return (
    <Editor
      initial={load.set}
      save={save}
      playHref={`/setlists/${id}/play`}
      share={<ShareBox id={id} initial={load.set.share_code} />}
      danger={<DeleteButton id={id} />}
    />
  );
}

export function AccountPlay({ id }: { id: string }) {
  const load = useSet({ id });
  if (load.state !== "ok") return <Status load={load} missing={NOT_YOURS} />;
  return <PlayView set={load.set} id={id} exitHref={`/setlists/${id}`} />;
}

export function SharedPlay({ code }: { code: string }) {
  const load = useSet({ code });
  if (load.state !== "ok") return <Status load={load} missing={LINK_OFF} />;
  return <PlayView set={load.set} id={`s.${code}`} exitHref={`/s/${code}`} />;
}

export function SharedView({ code }: { code: string }) {
  const load = useSet({ code });
  const router = useRouter();
  if (load.state !== "ok") return <Status load={load} missing={LINK_OFF} />;
  const { set } = load;
  const playable = set.items.filter((i) => i.song).length;
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-2">
      <Link href="/" className="inline-flex h-12 items-center text-lg text-bb-cue-gray active:text-bb-chart-white">
        ← All songs
      </Link>
      <h1 className="text-bb-display">{set.name}</h1>
      <p className="mb-3 text-lg text-bb-cue-gray">
        {[gigDate(set.gig_date), `${playable} song${playable === 1 ? "" : "s"}`, "view only"].filter(Boolean).join(" · ")}
      </p>
      {set.mine && (
        <p className="mb-3 text-lg">
          This is your setlist.{" "}
          <Link className="text-bb-chart-white underline" href={`/setlists/${set.id ?? ""}`}>
            Edit it
          </Link>
        </p>
      )}
      <button
        disabled={!playable}
        onClick={() => {
          enterFullscreen();
          router.push(`/s/${code}/play`);
        }}
        className={`${btn} ${primary} mb-4 h-14 w-full text-xl`}
      >
        Play set ▸
      </button>
      <SetSongList items={set.items} />
      <p className="mt-4 text-base text-bb-cue-gray">Shared from Broadway Book. Refresh to get the latest version of the list.</p>
    </main>
  );
}

function ShareBox({ id, initial }: { id: string; initial: string | null }) {
  const [code, setCode] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const url = code ? `${location.origin}/s/${code}` : null;
  const set = async (on: boolean) => {
    if (isOffline()) return setMsg(OFFLINE_MSG);
    setBusy(true);
    setMsg(null);
    try {
      setCode(await shareSetlist(id, on));
      setMsg(on ? "Link ready. Copy it to the band." : "Sharing stopped. The old link no longer works.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mb-6 border border-bb-rule-gray p-3">
      <h2 className="mb-1 text-lg font-semibold">Share with the band</h2>
      {url ? (
        <>
          <p className="mb-2 text-base text-bb-cue-gray">Anyone with this link can view and play the set (no sign-in). They see your edits when they refresh.</p>
          <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Share link" className="bb-input mb-2 h-12 w-full px-3 text-base" />
          <div className="flex flex-wrap gap-2">
            <CopyButton text={url} />
            <button disabled={busy} className={`${btn} ${plain}`} onClick={() => set(false)}>
              Stop sharing
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mb-2 text-base text-bb-cue-gray">Private. Only you can see it until you make a link.</p>
          <button disabled={busy} className={`${btn} ${plain}`} onClick={() => set(true)}>
            Make share link
          </button>
        </>
      )}
      {msg && (
        <p className="mt-2 text-base text-bb-chart-white" aria-live="polite">
          {msg}
        </p>
      )}
    </section>
  );
}

export function CopyButton({ text, label = "Copy link" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={`${btn} ${plain}`}
      onClick={async () => {
        try {
          if (navigator.share && matchMedia("(pointer: coarse)").matches) await navigator.share({ url: text });
          else await navigator.clipboard.writeText(text);
          setDone(true);
          window.setTimeout(() => setDone(false), 2000);
        } catch {
          // share sheet closed or clipboard blocked: the link is still in the box above
        }
      }}
    >
      {done ? "Done ✓" : label}
    </button>
  );
}

function DeleteButton({ id }: { id: string }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  return (
    <section className="border border-bb-rule-gray p-3">
      <button
        className={`${btn} bb-btn-danger`}
        onClick={async () => {
          if (isOffline()) return setErr(OFFLINE_MSG);
          if (!window.confirm("Delete this setlist? This can't be undone.")) return;
          try {
            await deleteSetlist(id);
            router.push("/setlists");
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      >
        Delete setlist
      </button>
      {err && <p className="bb-error mt-2">{err}</p>}
    </section>
  );
}
