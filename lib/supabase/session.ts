import { cookies } from "next/headers";
import { connection } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { parseAdminEmails, roleFor } from "@/lib/auth/roles";
import { serviceClient } from "./service";

/** Server client acting as the signed-in user (reads the session cookie). RLS applies. */
export async function sessionClient() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component, where cookies are read-only. proxy.ts refreshes them.
        }
      },
    },
  });
}

export type Role = "contributor" | "admin";
export interface CurrentUser {
  id: string;
  email: string | undefined;
  display_name: string | null;
  instrument: string | null;
  role: Role;
}

/** The signed-in user and their profile, or null when signed out. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  // Request-time only: the auth client checks token expiry with Date.now(), which Next
  // refuses during (runtime) prerendering.
  await connection();
  const db = await sessionClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;
  const { data: p } = await db
    .from("profiles")
    .select("display_name, instrument, role")
    .eq("id", user.id)
    .maybeSingle();
  return {
    id: user.id,
    email: user.email,
    display_name: p?.display_name ?? null,
    instrument: p?.instrument ?? null,
    role: (p?.role as Role) ?? "contributor",
  };
}

/**
 * Make profiles.role match ADMIN_EMAILS. Leaves roles alone when ADMIN_EMAILS is unset
 * or the service-role key is missing. Returns the role the user now has.
 */
export async function syncRole(userId: string, email: string | undefined, current: Role): Promise<Role> {
  const want = roleFor(email, parseAdminEmails(process.env.ADMIN_EMAILS));
  if (!want || want === current) return current;
  const svc = serviceClient();
  if (!svc) {
    console.warn("ADMIN_EMAILS is set but SUPABASE_SERVICE_ROLE_KEY is missing; roles not synced");
    return current;
  }
  const { error } = await svc.from("profiles").update({ role: want }).eq("id", userId);
  if (error) throw new Error(`role sync failed: ${error.message}`);
  return want;
}
