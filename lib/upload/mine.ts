// Uploaded charts you can open (your own, plus every admin's if you're an admin), kept on
// this phone for offline use (same rule as account setlists: only while signed in, under
// your user id, removed when you sign out). Never audio: only the chart text and its title.
import { browserClient } from "@/lib/supabase/browser";
import { dbKeys, KV, kvDel, kvGet, kvSet } from "@/lib/offline/db";
import { knownUserId } from "@/lib/offline/user";

export interface MineChart {
  id: string;
  slug: string;
  title: string;
  artist: string | null;
  key: string | null;
  chart_text: string;
  mine?: boolean; // false: another admin uploaded it (read only)
  by?: string | null; // who uploaded it, when it isn't yours
  created_at?: string | null; // when it was uploaded (newest first on Home)
}

/** Newest upload first; ones without a date (older phone copies) last, by title. */
export function newestFirst(list: MineChart[]): MineChart[] {
  return [...list].sort(
    (a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "") || a.title.localeCompare(b.title, "en", { sensitivity: "base" }),
  );
}

const key = (uid: string) => `mine:${uid}`;

/** Offline sync step: refresh the list while signed in, drop it when signed out. */
export async function syncMine(): Promise<void> {
  const db = browserClient();
  const uid = await knownUserId(db);
  const old = (await dbKeys(KV)).filter((k) => k.startsWith("mine:") && k !== (uid ? key(uid) : ""));
  await kvDel(old);
  if (!uid) return;
  const { data, error } = await db.rpc("upload_charts_visible");
  if (error) throw error;
  const list = ((data as MineChart[] | null) ?? []).filter((c) => c.chart_text);
  // Upload dates (the same rows the list came from; RLS lets you read exactly these).
  if (list.length) {
    const { data: dates } = await db.from("songs").select("id, created_at").in("id", list.map((c) => c.id));
    const at = new Map(((dates ?? []) as { id: string; created_at: string }[]).map((d) => [d.id, d.created_at]));
    for (const c of list) c.created_at = at.get(c.id) ?? null;
  }
  await kvSet(key(uid), newestFirst(list));
}

/** Save (or refresh) one chart right away, e.g. when its page opens. */
export async function rememberMine(c: MineChart): Promise<void> {
  try {
    const uid = await knownUserId(browserClient());
    if (!uid) return;
    const list = (await kvGet<MineChart[]>(key(uid))) ?? [];
    await kvSet(key(uid), [c, ...list.filter((x) => x.id !== c.id)]);
  } catch {
    // storage blocked: the page still works online
  }
}

export async function savedMine(id: string): Promise<MineChart | null> {
  const uid = await knownUserId(browserClient());
  if (!uid) return null;
  return ((await kvGet<MineChart[]>(key(uid))) ?? []).find((c) => c.id === id) ?? null;
}

export async function savedMineList(): Promise<MineChart[]> {
  const uid = await knownUserId(browserClient());
  return uid ? ((await kvGet<MineChart[]>(key(uid))) ?? []) : [];
}
