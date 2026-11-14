import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser, sessionClient, syncRole } from "@/lib/supabase/session";
import { PREFS_COOKIE, pickedFilter, readPrefs, type Prefs } from "@/lib/review/queue";

export interface Progress {
  total: number;
  verified: number; // Dropbox charts live and verified
  unverified: number; // live, nobody has verified them
  waiting: number; // not published yet
  oldest: { id: string; title: string; artist: string | null; since: string | null }[];
  people: { name: string; total: number; today: number; me: boolean }[];
}

/**
 * Signed-in check for every review page, plus the chosen order/filter (URL, then this
 * device's cookie). Who may review is decided by the database (admins + trusted reviewers);
 * a null progress means the database said no.
 */
export async function reviewContext(next: string, sp: { f?: string | string[]; o?: string | string[] }) {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  await syncRole(user.id, user.email, user.role);
  const db = await sessionClient();
  const cookie = (await cookies()).get(PREFS_COOKIE)?.value;
  const prefs: Prefs = readPrefs(sp, cookie);
  const { data, error } = await db.rpc("review_progress");
  return { db, prefs, picked: pickedFilter(sp, cookie), progress: error ? null : (data as Progress) };
}
