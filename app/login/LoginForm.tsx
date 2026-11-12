"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { browserClient } from "@/lib/supabase/browser";
import { safeNext } from "@/lib/auth/roles";

export default function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState(
    params.get("error") ? "That sign-in link expired or was already used. Send a new one." : "",
  );

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setError("");
    // Where to land after the email link (read by /auth/callback; same browser only).
    const next = safeNext(params.get("next"));
    document.cookie = `bb_next=${encodeURIComponent(next)}; path=/; max-age=3600; samesite=lax`;
    const { error } = await browserClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    if (error) {
      setState("idle");
      setError(
        error.status === 429 ? "Too many sign-in emails right now. Wait a few minutes and try again." : error.message,
      );
      return;
    }
    setState("sent");
  }

  if (state === "sent") {
    return (
      <div className="rounded-xl border border-line bg-panel p-5 text-lg">
        <p className="font-semibold">Check your email.</p>
        <p className="mt-1 text-muted">
          We sent a sign-in link to <span className="text-foreground">{email.trim()}</span>. Tap it on this phone.
        </p>
        <button
          type="button"
          onClick={() => setState("idle")}
          className="mt-4 h-11 text-base text-accent underline underline-offset-4"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={send} className="flex flex-col gap-3">
      <label htmlFor="email" className="text-lg font-medium">
        Email
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        inputMode="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="h-14 rounded-xl border border-line bg-panel px-4 text-xl outline-none focus:border-accent"
        placeholder="you@example.com"
      />
      {error && (
        <p role="alert" className="text-lg text-red-400">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={state === "sending"}
        className="h-14 rounded-xl bg-accent text-xl font-semibold text-black active:opacity-80 disabled:opacity-60"
      >
        {state === "sending" ? "Sending…" : "Email me a sign-in link"}
      </button>
      <p className="text-base text-muted">No password needed.</p>
    </form>
  );
}
