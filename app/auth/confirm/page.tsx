"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// Landing page for the magic-link email. Supabase's default email sends the sign-in tokens
// in the URL #fragment, which only the browser can see. We hand them to /auth/finish, which
// checks them, sets the session cookie and syncs the role. Works in any browser or mail app.
export default function ConfirmPage() {
  const [error, setError] = useState("");

  useEffect(() => {
    finishSignIn().then((message) => message && setError(message));
  }, []);

  return (
    <main className="mx-auto w-full max-w-md px-4 pb-16 pt-2">
      {error ? (
        <>
          <h1 className="text-3xl font-bold tracking-tight">Sign-in problem</h1>
          <p className="mb-6 mt-1 text-lg text-bb-cue-gray">{error} Send yourself a new link.</p>
          <Link
            href="/login"
            className="flex h-14 items-center justify-center rounded-xl bg-bb-downbeat-amber text-xl font-semibold text-bb-stage-black"
          >
            Get a new link
          </Link>
        </>
      ) : (
        <p className="pt-6 text-xl text-bb-cue-gray">Signing you in…</p>
      )}
    </main>
  );
}

/** Returns an error message, or null after starting the redirect. */
async function finishSignIn(): Promise<string | null> {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const next = new URLSearchParams(window.location.search).get("next") ?? "/";
  // Don't leave tokens in the address bar or history.
  window.history.replaceState(null, "", window.location.pathname);

  const access_token = hash.get("access_token");
  const refresh_token = hash.get("refresh_token");
  if (!access_token || !refresh_token) {
    return hash.get("error") ? "That sign-in link expired or was already used." : "That sign-in link didn't work.";
  }
  try {
    const r = await fetch("/auth/finish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ access_token, refresh_token, next }),
    });
    if (!r.ok) return "That sign-in link didn't work.";
    const { dest } = (await r.json()) as { dest: string };
    window.location.replace(dest); // full load so the account bar picks up the new session
    return null;
  } catch {
    return "Couldn't finish signing in. Check your connection.";
  }
}
