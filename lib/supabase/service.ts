import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client. SERVER ONLY: bypasses RLS. Used for one thing: copying
 * ADMIN_EMAILS into profiles.role. Never import this from a "use client" file.
 * Returns null when SUPABASE_SERVICE_ROLE_KEY isn't set.
 */
export function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (typeof window !== "undefined") throw new Error("serviceClient() is server-only");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
