"use client";

import { useEffect, useState } from "react";

/**
 * Link to the original handwritten PDF, shown to admins only.
 * Placeholder until the Dropbox import step wires up real links.
 * Supabase is only loaded when an auth cookie exists, so most viewers pay nothing for it.
 */
export default function AdminPdfLink() {
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    if (!document.cookie.includes("-auth-token")) return;
    let live = true;
    (async () => {
      try {
        const { browserClient } = await import("@/lib/supabase/browser");
        const sb = browserClient();
        const {
          data: { user },
        } = await sb.auth.getUser();
        if (!user) return;
        const { data } = await sb.from("profiles").select("role").eq("id", user.id).maybeSingle();
        if (live && data?.role === "admin") setAdmin(true);
      } catch {
        // not signed in or offline: no link
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  if (!admin) return null;
  return (
    <a
      href="#original-pdf"
      onClick={(e) => {
        e.preventDefault();
        alert("Original PDF links arrive with the Dropbox import step.");
      }}
      className="bb-btn bb-btn-secondary mt-6 h-12 px-4 text-lg font-normal text-bb-cue-gray"
    >
      Original PDF (admin, placeholder)
    </a>
  );
}
