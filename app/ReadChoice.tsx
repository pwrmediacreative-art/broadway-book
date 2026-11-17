"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { syncDisplay } from "@/lib/display";
import { browserClient } from "@/lib/supabase/browser";
import { PREF, usePref } from "@/lib/prefs";
import { DisplayPicker } from "./Settings";

const noop = () => () => {};
/** true once the page runs in the browser (device settings are readable). */
const useHydrated = () => useSyncExternalStore(noop, () => true, () => false);

/** First song a player opens on this device: "How do you read charts?" once, then never again. */
export default function ReadChoice() {
  const hydrated = useHydrated();
  const display = usePref(PREF.display);
  // Signed in on a new phone: their account may already know. Ask only after checking.
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (!hydrated || display) return;
    let alive = true;
    const done = () => alive && setChecked(true);
    // The session on this phone (no network needed), not the remembered user, which the top
    // bar only fills in after its own profile load.
    void browserClient()
      .auth.getSession()
      .then(({ data }) => (data.session ? syncDisplay(browserClient(), data.session.user.id) : undefined))
      .catch(() => {})
      .finally(done);
    return () => {
      alive = false;
    };
  }, [hydrated, display]);

  const open = hydrated && !display && checked;
  // While it's open, keys and pedals must not turn songs or pages behind it.
  useEffect(() => {
    if (!open) return;
    const stop = (e: KeyboardEvent) => {
      if (e.key !== "Tab") e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", stop, true);
    return () => window.removeEventListener("keydown", stop, true);
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-end bg-bb-stage-black/85 sm:items-center sm:justify-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bb-read-q"
        className="w-full border-t border-bb-rule-gray bg-bb-house-black p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-w-md sm:border"
      >
        <h2 id="bb-read-q" className="mb-4 text-2xl font-bold">
          How do you read charts?
        </h2>
        <DisplayPicker autoFocus />
        <p className="mt-3 text-base text-bb-cue-gray">You can change it any time in Settings (the gear at the top) or with 123 / ABC on a song.</p>
      </div>
    </div>
  );
}
