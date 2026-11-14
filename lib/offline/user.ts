"use client";

// Who is signed in on this phone, remembered so the app still knows offline (the sign-in
// token can't be renewed without a connection). Holds no secrets: an id and a display name.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isOffline } from "./status";

const KEY = "bb.me";

export interface Me {
  id: string;
  name?: string;
  admin?: boolean;
  reviewer?: boolean;
}

export function rememberedUser(): Me | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return v && typeof v.id === "string" ? v : null;
  } catch {
    return null;
  }
}

export function rememberUser(me: Me | null) {
  try {
    if (!me) return localStorage.removeItem(KEY);
    const old = rememberedUser();
    localStorage.setItem(KEY, JSON.stringify(old?.id === me.id ? { ...old, ...me } : me));
  } catch {
    // storage blocked
  }
}

/**
 * The signed-in user's id. Online it comes from the session; offline (or when the session
 * can't be read for lack of a network) it is the user remembered on this phone.
 */
export async function knownUserId(db: SupabaseClient): Promise<string | null> {
  if (isOffline()) {
    const me = rememberedUser();
    if (me) return me.id;
  }
  try {
    const r = await Promise.race([
      db.auth.getSession(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
    ]);
    if (!r) return rememberedUser()?.id ?? null; // still waiting on the network
    if (r.data.session) {
      rememberUser({ id: r.data.session.user.id });
      return r.data.session.user.id;
    }
    if (r.error || isOffline()) return rememberedUser()?.id ?? null;
    rememberUser(null);
    return null;
  } catch {
    return rememberedUser()?.id ?? null;
  }
}
