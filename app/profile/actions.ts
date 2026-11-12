"use server";

import { redirect } from "next/navigation";
import { sessionClient } from "@/lib/supabase/session";
import { cleanProfile, safeNext } from "@/lib/auth/roles";

export interface ProfileState {
  error?: string;
}

export async function saveProfile(_prev: ProfileState, form: FormData): Promise<ProfileState> {
  const db = await sessionClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login?next=/profile");

  const clean = cleanProfile(form.get("display_name"), form.get("instrument"));
  if (!clean.ok) return { error: clean.error };

  // RLS: you can only update your own row, and only these two columns.
  const { error } = await db
    .from("profiles")
    .update({ display_name: clean.display_name, instrument: clean.instrument })
    .eq("id", user.id);
  if (error) return { error: "Couldn't save. Try again." };

  redirect(safeNext(String(form.get("next") ?? "/")));
}
