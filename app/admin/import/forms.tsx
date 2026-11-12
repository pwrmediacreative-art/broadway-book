"use client";

import { useActionState } from "react";
import { fixName, scanDropbox, type FixState, type ScanState } from "./actions";

const button =
  "min-h-11 rounded-xl bg-accent px-5 text-lg font-semibold text-black disabled:opacity-60";
const input =
  "min-h-11 w-full rounded-lg border border-line bg-background px-3 text-lg text-foreground";

export function ScanButton({ disabled }: { disabled?: boolean }) {
  const [state, action, pending] = useActionState<ScanState, FormData>(scanDropbox, {});
  return (
    <form action={action} className="mb-6">
      <button type="submit" className={button} disabled={disabled || pending}>
        {pending ? "Scanning Dropbox…" : "Scan Dropbox"}
      </button>
      <p role="status" aria-live="polite" className="mt-2 text-lg">
        {state.error && <span className="text-red-400">{state.error}</span>}
        {state.summary && <span className="text-muted">{state.summary}</span>}
      </p>
    </form>
  );
}

export function FixNameForm({ id, title, artist }: { id: string; title: string | null; artist: string | null }) {
  const [state, action, pending] = useActionState<FixState, FormData>(fixName, {});
  return (
    <form action={action} className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
      <input type="hidden" name="id" value={id} />
      <label className="sr-only" htmlFor={`t-${id}`}>Title</label>
      <input id={`t-${id}`} name="title" defaultValue={title ?? ""} placeholder="Title" className={input} required />
      <label className="sr-only" htmlFor={`a-${id}`}>Artist</label>
      <input id={`a-${id}`} name="artist" defaultValue={artist ?? ""} placeholder="Artist" className={input} required />
      <button type="submit" className={button} disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </button>
      {state.error && <p className="text-red-400 sm:col-span-3">{state.error}</p>}
    </form>
  );
}
