"use client";

import { useEffect, useState } from "react";
import { useInstall } from "@/lib/offline/install";
import { ago, count } from "@/lib/offline/plan";
import { useSyncStatus } from "@/lib/offline/sync";

const IOS_STEPS = ["Tap the Share button (the square with an arrow) in Safari.", "Scroll down and tap “Add to Home Screen”.", "Tap “Add”."];
const ANDROID_STEPS = ["Tap the ⋮ menu at the top right of Chrome.", "Tap “Install app” or “Add to Home screen”.", "Tap “Install”."];

function Steps({ title, steps }: { title: string; steps: string[] }) {
  return (
    <div className="mb-4">
      <h3 className="mb-1 text-lg font-semibold">{title}</h3>
      <ol className="list-decimal space-y-1 pl-6 text-lg">
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </div>
  );
}

function Sheet({ onClose }: { onClose: () => void }) {
  const { kind, canPrompt, prompt } = useInstall();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] flex items-end bg-bb-stage-black/80 sm:items-center sm:justify-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Install Broadway Book"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85dvh] w-full overflow-y-auto rounded-bb-none border-t border-bb-rule-gray bg-bb-house-black p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-md sm:border"
      >
        <div className="mb-3 flex items-center gap-2">
          <h2 className="min-w-0 flex-1 text-xl font-bold">Install Broadway Book</h2>
          <button onClick={onClose} aria-label="Close" className="bb-btn bb-btn-quiet size-11 p-0 text-2xl text-bb-cue-gray">
            ✕
          </button>
        </div>
        <p className="mb-4 text-lg text-bb-cue-gray">It opens from your home screen like an app and works with no signal.</p>
        {canPrompt ? (
          <button
            className="bb-btn bb-btn-primary mb-4 h-14 w-full text-xl"
            onClick={async () => {
              if (await prompt()) onClose();
            }}
          >
            Install
          </button>
        ) : (
          <>
            {kind !== "android" && <Steps title="iPhone" steps={IOS_STEPS} />}
            {kind !== "ios" && <Steps title="Android" steps={ANDROID_STEPS} />}
          </>
        )}
        {kind === "ios" && (
          <p className="text-base text-bb-cue-gray">
            Installing also keeps your saved charts on the phone. In Safari alone, iOS can clear them after a week without opening the site.
          </p>
        )}
      </div>
    </div>
  );
}

/** Home page, above search: one compact row. Gone for good once dismissed or installed. */
export function InstallCard() {
  const { showCard, canPrompt, prompt, dismiss } = useInstall();
  const [open, setOpen] = useState(false);
  if (!showCard) return null;
  return (
    <div className="bb-panel mb-3 flex items-center gap-2 py-1 pl-3 pr-1">
      <p className="min-w-0 flex-1 text-base leading-snug">Install the app: works with no signal.</p>
      <button
        className="bb-btn bb-btn-secondary h-11 shrink-0 px-4 text-base active:bg-bb-rule-gray"
        onClick={() => (canPrompt ? void prompt() : setOpen(true))}
      >
        {canPrompt ? "Install" : "How"}
      </button>
      <button onClick={dismiss} aria-label="Dismiss" className="bb-btn bb-btn-quiet size-11 shrink-0 p-0 text-xl text-bb-cue-gray active:bg-bb-rule-gray">
        ✕
      </button>
      {open && <Sheet onClose={() => setOpen(false)} />}
    </div>
  );
}

/** Home page footer: what is saved on this phone, and a standing "Install app" link. */
export function HomeFooter() {
  const { kind } = useInstall();
  const s = useSyncStatus();
  const [open, setOpen] = useState(false);
  // Ticks once a minute so "updated 5 min ago" stays true (0 until the page is in the browser).
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = window.setInterval(tick, 60_000);
    return () => window.clearInterval(t);
  }, []);

  let line: string | null = null;
  if (!s.ready) line = null;
  else if (s.phase === "blocked") line = "Couldn’t save charts on this phone. They’ll load while you’re online.";
  else if (s.phase === "saving") line = s.total ? `Saving charts… ${count(s.saved)} of ${count(s.total)}` : "Saving charts…";
  else if (s.saved > 0)
    line = `${count(s.saved)} chart${s.saved === 1 ? "" : "s"} saved on this phone${s.at ? ` · updated ${ago(s.at, Math.max(now, s.at))}` : ""}`;

  return (
    <footer className="mt-8 flex flex-col items-center gap-1 text-center text-base text-bb-cue-gray">
      {line && (
        <p role="status" data-saved-status>
          {line}
        </p>
      )}
      {kind !== null && kind !== "installed" && (
        <button onClick={() => setOpen(true)} className="min-h-11 px-3 underline active:text-bb-chart-white">
          Install app
        </button>
      )}
      {open && <Sheet onClose={() => setOpen(false)} />}
    </footer>
  );
}
