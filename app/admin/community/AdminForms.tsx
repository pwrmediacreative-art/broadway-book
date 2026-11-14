"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { resolveReport, setBlocked, setReviewer, setSetting } from "@/app/community/actions";

export function SettingsForm({ settings }: { settings: { key: string; value: number; label: string }[] }) {
  const router = useRouter();
  const [values, setValues] = useState(() => Object.fromEntries(settings.map((s) => [s.key, String(s.value)])));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      for (const s of settings) {
        const v = Number(values[s.key]);
        if (v === s.value) continue;
        const r = await setSetting(s.key, v);
        if (!r.ok) return setMsg({ ok: false, text: `${s.label}: ${r.error}` });
      }
      setMsg({ ok: true, text: "Saved." });
      router.refresh();
    });
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-bb-rule-gray bg-bb-case-charcoal p-4">
      {settings.map((s) => (
        <label key={s.key} className="flex items-center justify-between gap-3 text-lg">
          <span>{s.label}</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={1000}
            value={values[s.key]}
            onChange={(e) => setValues((v) => ({ ...v, [s.key]: e.target.value }))}
            className="min-h-12 w-24 rounded-xl border border-bb-rule-gray bg-bb-house-black px-3 text-right text-lg"
          />
        </label>
      ))}
      <button disabled={pending} onClick={save} className="min-h-12 rounded-xl bg-bb-downbeat-amber text-lg font-bold text-bb-stage-black disabled:opacity-40">
        Save rules
      </button>
      {msg && <p className={`text-lg ${msg.ok ? "text-emerald-300" : "text-red-300"}`}>{msg.text}</p>}
    </div>
  );
}

export function ResolveButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => start(async () => void ((await resolveReport(id)).ok && router.refresh()))}
      className="min-h-12 rounded-xl border border-bb-rule-gray px-4 text-lg disabled:opacity-40"
    >
      Mark handled
    </button>
  );
}

export function BlockToggle({ userId, blocked, name }: { userId: string; blocked: boolean; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <button
        disabled={pending}
        onClick={() => {
          const q = blocked
            ? `Unblock ${name}?`
            : `Block ${name}? They can still read charts but can't suggest, vote or report. Their open suggestions are withdrawn.`;
          if (!window.confirm(q)) return;
          start(async () => {
            const r = await setBlocked(userId, !blocked);
            if (!r.ok) return setErr(r.error);
            router.refresh();
          });
        }}
        className={`min-h-12 rounded-xl border px-4 text-lg disabled:opacity-40 ${blocked ? "border-bb-rule-gray" : "border-red-500/60 text-red-300"}`}
      >
        {blocked ? "Unblock" : "Block"}
      </button>
      {err && <span className="w-full text-red-300">{err}</span>}
    </>
  );
}

export function ReviewerToggle({ userId, on, name }: { userId: string; on: boolean; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <button
        disabled={pending}
        onClick={() => {
          const q = on
            ? `Stop ${name} reviewing imports?`
            : `Make ${name} a trusted reviewer? They can publish imported charts from /admin/review and get a Reviewer badge.`;
          if (!window.confirm(q)) return;
          start(async () => {
            const r = await setReviewer(userId, !on);
            if (!r.ok) return setErr(r.error);
            router.refresh();
          });
        }}
        className={`min-h-12 rounded-xl border px-4 text-lg disabled:opacity-40 ${on ? "border-bb-rule-gray" : "border-sky-400/60 text-sky-200"}`}
      >
        {on ? "Remove reviewer" : "Make reviewer"}
      </button>
      {err && <span className="w-full text-red-300">{err}</span>}
    </>
  );
}
