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
  await kvSet(key(uid), list);
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
