"use client";

// The Settings tab's pieces. DisplayPicker is also the first-visit "How do you read charts?" card.
import Link from "next/link";
import { clampStageSize } from "@/lib/chart";
import { setDisplay, type Display } from "@/lib/display";
import { useNavMe } from "@/lib/nav/me";
import { OFFLINE_MSG, useOffline } from "@/lib/offline/status";
import { PREF, setPref, stageFull, usePref } from "@/lib/prefs";

/** The two big "How do you read charts?" buttons (first visit and Settings). */
export function DisplayPicker({ onPick, autoFocus = false }: { onPick?: (v: Display) => void; autoFocus?: boolean }) {
  const cur = usePref(PREF.display);
  const pick = (v: Display) => {
    setDisplay(v);
    onPick?.(v);
  };
  const opt = (v: Display, title: string, sample: string) => (
    <button
      type="button"
      autoFocus={autoFocus && v === "numbers"}
      onClick={() => pick(v)}
      aria-pressed={cur === v}
      className={`bb-btn flex min-h-20 flex-1 flex-col items-center justify-center gap-1 px-3 py-3 ${cur === v ? "bb-btn-primary" : "bb-btn-secondary"}`}
    >
      <span className="text-xl font-bold">{title}</span>
      <span className="text-base font-normal">{sample}</span>
    </button>
  );
  return (
    <div className="flex gap-3">
      {opt("numbers", "Numbers", "Nashville")}
      {opt("chords", "Chords", "C, G, Am…")}
    </div>
  );
}

/** The Settings tab (/settings): reading, display, account, and links for admins. Works signed in or out, and offline. */
export default function SettingsView() {
  const me = useNavMe();
  const offline = useOffline();
  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-16 pt-2">
      <h1 className="mb-6 text-bb-display">Settings</h1>

      <h2 className="mb-2 text-xl font-bold">How do you read charts?</h2>
      <DisplayPicker />
      <p className="mt-2 text-base text-bb-cue-gray">The default on every chart, stage mode and setlists. The 123 / ABC switch on a song still flips it.</p>
      <LayoutSetting />
      <StageSize />

      <h2 className="mb-2 mt-10 text-xl font-bold">Account</h2>
      {me === undefined ? (
        <p className="text-lg text-bb-cue-gray">Loading…</p>
      ) : me === null ? (
        <>
          <p className="mb-3 text-lg text-bb-cue-gray">Sign in to suggest fixes, vote, and keep setlists on your account. Viewing never needs it.</p>
          {offline ? (
            <p className="text-lg text-bb-cue-gray">{OFFLINE_MSG}</p>
          ) : (
            <Link href="/login?next=%2Fsettings" className="bb-btn bb-btn-secondary h-12 px-6 text-lg">
              Sign in
            </Link>
          )}
        </>
      ) : (
        <>
          <Rows>
            <Row href="/profile" label={me.name} hint={me.instrument ?? "Name and instrument"} />
            <Row href="/notifications" label="Notifications" hint={me.unread ? `${me.unread} new` : undefined} />
          </Rows>
          <form action="/auth/signout" method="post" className="mt-4">
            <button type="submit" disabled={offline} title={offline ? OFFLINE_MSG : undefined} className="bb-btn bb-btn-secondary h-12 px-6 text-lg">
              Sign out
            </button>
          </form>
        </>
      )}

      <h2 className="mb-2 mt-10 text-xl font-bold">Your charts</h2>
      <Rows>
        <Row href="/notes" label="My notes" hint="Flags and my versions" />
        {me && <Row href="/profile/versions" label="My versions" hint="Songs you changed for yourself" />}
        {me?.upload && <Row href="/upload" label="Upload a chart" hint="Moises chord chart to a private chart" />}
      </Rows>

      {me && (me.admin || me.reviewer) && (
        <>
          <h2 className="mb-2 mt-10 text-xl font-bold">{me.admin ? "Admin" : "Reviewer"}</h2>
          <Rows>
            {me.admin && <Row href="/admin" label="Admin" hint="Dashboard" />}
            <Row href="/admin/review" label="Review charts" />
            {me.admin && <Row href="/admin/import" label="Import" />}
            {me.admin && <Row href="/admin/community" label="Community rules" />}
          </Rows>
        </>
      )}
    </main>
  );
}

function Rows({ children }: { children: React.ReactNode }) {
  return <ul className="divide-y divide-bb-rule-gray border-y border-bb-rule-gray">{children}</ul>;
}

function Row({ href, label, hint }: { href: string; label: string; hint?: string }) {
  return (
    <li>
      <Link href={href} className="flex min-h-14 items-center gap-3 px-1 py-2 active:bg-bb-case-charcoal">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-lg font-semibold">{label}</span>
          {hint && <span className="block truncate text-base text-bb-cue-gray">{hint}</span>}
        </span>
        <span aria-hidden className="text-2xl text-bb-cue-gray">
          ›
        </span>
      </Link>
    </li>
  );
}

/** Stage mode fits the text to the screen unless the player set a size there. */
function StageSize() {
  const size = clampStageSize(Number(usePref(PREF.size)) || null);
  return (
    <>
      <h3 className="mb-2 mt-6 text-lg font-semibold">Stage text size</h3>
      <div className="flex items-center gap-3">
        <p className="flex-1 text-lg">{size ? `${size}px, set in stage mode` : "Auto: fits the screen"}</p>
        {size && (
          <button type="button" onClick={() => setPref(PREF.size, null)} className="bb-btn bb-btn-secondary h-12 px-4 text-lg">
            Back to auto
          </button>
        )}
      </div>
      <p className="mt-2 text-base text-bb-cue-gray">Change it with the Text size slider in stage mode.</p>
    </>
  );
}

/** Scrolling / Full song, and the smallest text size Full song uses before it turns pages.
 *  Shows what stage mode opens in: Full song for players who never picked (Q17). */
function LayoutSetting() {
  const whole = stageFull(usePref(PREF.layout));
  const min = Number(usePref(PREF.wholeMin)) || 24;
  const opt = (on: boolean, label: string, onClick: () => void) => (
    <button type="button" aria-pressed={on} onClick={onClick} className={`bb-btn h-12 flex-1 px-3 text-lg ${on ? "bb-btn-primary" : "bb-btn-secondary"}`}>
      {label}
    </button>
  );
  return (
    <>
      <h3 className="mb-2 mt-6 text-lg font-semibold">Chart layout</h3>
      <div className="flex gap-3">
        {opt(!whole, "Scrolling", () => setPref(PREF.layout, "scroll"))}
        {opt(whole, "Full song", () => setPref(PREF.layout, "whole"))}
      </div>
      <p className="mt-2 text-base text-bb-cue-gray">
        Full song lays the chart out like a paper chart, on one screen in columns. If it can’t fit, it turns pages (pedal, arrows, swipe or tap an edge). Scrolling shows one column that can scroll by itself.
      </p>
      {whole && (
        <>
          <p className="mb-2 mt-3 text-base">Smallest text before pages</p>
          <div className="flex gap-2">
            {[20, 24, 28, 32].map((n) => (
              <span key={n} className="contents">
                {opt(min === n, `${n}`, () => setPref(PREF.wholeMin, n === 24 ? null : String(n)))}
              </span>
            ))}
          </div>
        </>
      )}
    </>
  );
}
