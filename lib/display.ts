"use client";

// How the player reads charts: Numbers or Chords. Kept per device (PREF.display) and, when
// signed in, in the account (user_prefs) so it follows them. The most recent change wins,
// whichever side it came from, and is copied to the other side.
import type { SupabaseClient } from "@supabase/supabase-js";
import { browserClient } from "@/lib/supabase/browser";
import { rememberedUser } from "@/lib/offline/user";
import { isOffline } from "@/lib/offline/status";
import { PREF, readPref, setPref } from "@/lib/prefs";

export { isDisplay, newer, type Display } from "./display-rule";
import { isDisplay, newer, type Display } from "./display-rule";

const device = () => {
  const v = readPref(PREF.display);
  return { v: isDisplay(v) ? v : null, at: readPref(PREF.displayAt) };
};

async function push(db: SupabaseClient, userId: string, v: Display, at: string) {
  const { error } = await db.from("user_prefs").upsert({ user_id: userId, chart_display: v, chart_display_at: at, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

/** Set the choice on this device (and the account when signed in). */
export function setDisplay(v: Display) {
  const at = new Date().toISOString();
  setPref(PREF.display, v);
  setPref(PREF.displayAt, at);
  const me = rememberedUser();
  if (me && !isOffline()) void push(browserClient(), me.id, v, at).catch(() => {});
}

/** Signed in: line up device and account, newest wins. Safe to call often; never throws. */
export async function syncDisplay(db: SupabaseClient = browserClient(), userId = rememberedUser()?.id): Promise<void> {
  if (!userId || isOffline()) return;
  try {
    const { data } = await db.from("user_prefs").select("chart_display, chart_display_at").eq("user_id", userId).maybeSingle();
    const acc = { v: isDisplay(data?.chart_display) ? data.chart_display : null, at: (data?.chart_display_at as string | null) ?? null };
    const dev = device();
    const win = newer(dev, acc);
    if (win === "account" && acc.v) {
      setPref(PREF.display, acc.v);
      setPref(PREF.displayAt, acc.at);
    } else if (win === "device" && dev.v) {
      await push(db, userId, dev.v, dev.at ?? new Date().toISOString());
    }
  } catch {
    // offline or blocked: the device choice stands
  }
}
