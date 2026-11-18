"use server";

// Server actions for player-made charts (Q16). They run as the signed-in player (session
// client), so RLS and the database functions decide what's allowed: only the owner can see
// or change a chart, a chart waiting for library votes is locked, and approval happens in
// the database. The chart text is always checked here with our parser before it is saved.
import { checkChart, MAX_CUE_WORDS } from "@/lib/chart";
import { getMeta } from "@/lib/chart/parse";
import { headerError, isBar, newChartText, TIMES } from "@/lib/make/model";
import { sessionClient } from "@/lib/supabase/session";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const NOT_SIGNED_IN = { ok: false as const, error: "Sign in first." };
const UUID = /^[0-9a-f-]{36}$/;
const plain = (m: string) =>
  /permission denied|row-level security/i.test(m) ? "You can't do that." : m.replace(/^.*?ERROR:\s*/, "");

async function signedIn() {
  const db = await sessionClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  return { db, user };
}

/** Parse, guard and canonicalise chart text. */
function checked(text: string) {
  const c = checkChart(text);
  if (c.error || !c.doc) return { error: `Chart format error: ${c.error}` } as const;
  if (c.longCues.length) return { error: `Notes must be ${MAX_CUE_WORDS} words or fewer (no lyrics): "${c.longCues[0]}"` } as const;
  const m = getMeta(c.doc);
  if (!m.title) return { error: "Give the song a title." } as const;
  return { text: c.canonical!, doc: c.doc, title: m.title, artist: m.artist } as const;
}

/** New chart from the first screen's header. From a setlist's "Add song", it goes on the end of that setlist. */
export async function createChart(input: {
  title: string;
  artist: string;
  key: string | null;
  time: string;
  bpm: number | null;
  setlist: string | null;
}): Promise<Result<{ id: string; setlistError: string | null }>> {
  const { db, user } = await signedIn();
  if (!user) return NOT_SIGNED_IN;
  const time = (TIMES as readonly string[]).includes(input.time) ? input.time : "4/4";
  const bad = headerError({ ...input, time });
  if (bad) return { ok: false, error: bad };
  const c = checked(newChartText({ title: input.title, artist: input.artist, key: input.key, time, bpm: input.bpm }));
  if ("error" in c) return { ok: false, error: c.error! };
  const { data, error } = await db.rpc("chart_create", { p_title: c.title, p_artist: c.artist, p_chart: c.text });
  if (error) return { ok: false, error: plain(error.message) };
  const made = data as { id: string; slug: string };
  let setlistError: string | null = null;
  if (input.setlist && UUID.test(input.setlist)) {
    const { error: e } = await db.rpc("setlist_add", { p_id: input.setlist, p_slug: made.slug });
    if (e) setlistError = plain(e.message);
  }
  return { ok: true, id: made.id, setlistError };
}

/** Autosave. Returns when it was saved. */
export async function saveChart(id: string, text: string): Promise<Result<{ savedAt: string }>> {
  if (!UUID.test(id)) return { ok: false, error: "Chart not found." };
  const { db, user } = await signedIn();
  if (!user) return NOT_SIGNED_IN;
  const c = checked(text);
  if ("error" in c) return { ok: false, error: c.error! };
  const { data, error } = await db.rpc("chart_save", { p_song: id, p_chart: c.text, p_title: c.title, p_artist: c.artist });
  if (error) return { ok: false, error: plain(error.message) };
  return { ok: true, savedAt: (data as { saved_at: string }).saved_at };
}

export async function deleteChart(id: string): Promise<Result> {
  if (!UUID.test(id)) return { ok: false, error: "Chart not found." };
  const { db, user } = await signedIn();
  if (!user) return NOT_SIGNED_IN;
  const { error } = await db.rpc("chart_delete", { p_song: id });
  return error ? { ok: false, error: plain(error.message) } : { ok: true };
}

/** Send the saved chart to the library vote. It locks until it's approved, closed or withdrawn. */
export async function submitChart(id: string, note: string): Promise<Result<{ proposal: string }>> {
  if (!UUID.test(id)) return { ok: false, error: "Chart not found." };
  const { db, user } = await signedIn();
  if (!user) return NOT_SIGNED_IN;
  const { data: song } = await db
    .from("songs")
    .select("id, current:revisions!songs_current_revision_fk(chart_text)")
    .eq("id", id)
    .eq("status", "private")
    .eq("owner_id", user.id)
    .maybeSingle();
  const text = (song?.current as unknown as { chart_text: string } | null)?.chart_text;
  if (!text) return { ok: false, error: "Chart not found." };
  const c = checked(text);
  if ("error" in c) return { ok: false, error: c.error! };
  const bars = c.doc.lines.some((l) => (l.kind === "section" || l.kind === "rows") && l.rows.some((r) => r.some(isBar)));
  if (!bars) return { ok: false, error: "Add some bars before you send it to the library." };
  const { data, error } = await db.rpc("chart_submit", { p_song: id, p_note: note.trim().slice(0, 500) });
  if (error) return { ok: false, error: plain(error.message) };
  return { ok: true, proposal: data as string };
}

export async function withdrawChart(id: string): Promise<Result> {
  if (!UUID.test(id)) return { ok: false, error: "Chart not found." };
  const { db, user } = await signedIn();
  if (!user) return NOT_SIGNED_IN;
  const { error } = await db.rpc("chart_withdraw", { p_song: id });
  return error ? { ok: false, error: plain(error.message) } : { ok: true };
}

/** "Library chart is in E. Use E?": the key of a library song with this title + artist. */
export async function libraryKey(title: string, artist: string): Promise<string | null> {
  if (!title.trim()) return null;
  const { db } = await signedIn();
  const { data } = await db.rpc("library_key", { p_title: title.slice(0, 200), p_artist: artist.slice(0, 200) });
  return typeof data === "string" ? data : null;
}
