"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
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
    // Implicit flow (no PKCE): the link carries its own tokens, so it works in any browser
    // or mail app, not just this one. /auth/confirm turns them into a session cookie.
    const next = safeNext(params.get("next"));
    const otp = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { error } = await otp.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${location.origin}/auth/confirm?next=${encodeURIComponent(next)}` },
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
      <div className="rounded-xl border border-bb-rule-gray bg-bb-case-charcoal p-5 text-lg">
        <p className="font-semibold">Check your email.</p>
        <p className="mt-1 text-bb-cue-gray">
          We sent a sign-in link to <span className="text-bb-chart-white">{email.trim()}</span>. Tap it to sign in.
        </p>
        <button
          type="button"
          onClick={() => setState("idle")}
          className="mt-4 h-11 text-base text-bb-downbeat-amber underline underline-offset-4"
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
        className="h-14 rounded-xl border border-bb-rule-gray bg-bb-case-charcoal px-4 text-xl outline-none focus:border-bb-downbeat-amber"
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
        className="h-14 rounded-xl bg-bb-downbeat-amber text-xl font-semibold text-bb-stage-black active:opacity-80 disabled:opacity-60"
      >
        {state === "sending" ? "Sending…" : "Email me a sign-in link"}
      </button>
      <p className="text-base text-bb-cue-gray">No password needed.</p>
    </form>
  );
}
