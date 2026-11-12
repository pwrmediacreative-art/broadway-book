import { createBrowserClient } from "@supabase/ssr";

/** Browser client (anon key + the signed-in user's session cookie). RLS applies. */
export function browserClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
