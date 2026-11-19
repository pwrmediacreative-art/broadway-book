// Blocker check for per-song lyrics (Q18) against the real database: a player's Lyrics on/off
// and "Adjust lyrics" placements are owner-only, saved only while the /admin lyrics audience
// includes them, and hold numbers only (never lyric text). Uses throwaway users and a throwaway
// song, and puts the audience setting back the way it found it.
// Run: npm run check:lyrics-placements   (needs SUPABASE_SERVICE_ROLE_KEY)
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const svc = createClient(url, serviceKey, opts);
const anon = createClient(url, anonKey, opts);

let failed = 0;
const pass = (m) => console.log("PASS", m);
const fail = (m) => {
  failed++;
  console.log("FAIL", m);
};
const ok = (r, m) => (r.error ? fail(`${m}: ${r.error.message}`) : pass(m));
const truthy = (v, m) => (v ? pass(m) : fail(m));
const refused = (r, m) => truthy(!!r.error, m);

const stamp = Date.now();
async function makeUser(tag) {
  const email = `lyrics-place-${tag}-${stamp}@example.com`;
  const created = await svc.auth.admin.createUser({ email, email_confirm: true });
  if (created.error) throw created.error;
  const link = await svc.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  const db = createClient(url, anonKey, opts);
  const v = await db.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
  if (v.error) throw v.error;
  return { id: created.data.user.id, db };
}

const users = [];
const songs = [];
const start = (await svc.from("settings").select("value").eq("key", "lyrics_audience").single()).data?.value;
try {
  truthy(start !== undefined, `audience setting exists (now ${start})`);
  const slug = `lyrics-place-check-${stamp}`;
  const s = await svc.from("songs").insert({ slug, title: "Lyrics Place Check", artist: "Check", status: "published" }).select("id").single();
  if (s.error) throw s.error;
  const songId = s.data.id;
  songs.push(songId);
  const draft = await svc.from("songs").insert({ slug: `${slug}-draft`, title: "Lyrics Place Draft", artist: "Check", status: "needs_review" }).select("id").single();
  if (draft.error) throw draft.error;
  songs.push(draft.data.id);

  const [P, A, B] = await Promise.all(["player", "admin-a", "admin-b"].map(makeUser));
  users.push(P, A, B);
  await svc.from("profiles").update({ role: "admin" }).in("id", [A.id, B.id]);
  const setAudience = async (v) => ok(await svc.from("settings").update({ value: v }).eq("key", "lyrics_audience"), `audience set to ${v} for the check`);
  const mine = async (db) => db.rpc("lyrics_mine", { p_slug: slug });
  const save = (db, extra = {}) =>
    db.rpc("lyrics_save_mine", { p_song: songId, p_shown: true, p_placements: [0, 12345, 0, 2, 7, -99, 1, 0], p_lrclib_id: 4242, p_at: new Date().toISOString(), ...extra });

  // --- Admins only (today's audience) ---------------------------------------------------
  await setAudience(1);
  truthy((await mine(anon)).error || ((await mine(anon)).data ?? []).length === 0, "signed-out gets nothing from lyrics_mine");
  truthy(((await mine(P.db)).data ?? []).length === 0, "player outside the audience gets no row");
  refused(await save(P.db), "player outside the audience can't save");
  const first = await mine(A.db);
  truthy(first.data?.length === 1 && first.data[0].song_id === songId && first.data[0].shown === null, "admin gets the song id, nothing saved yet");
  ok(await save(A.db), "admin saves on + placements");
  const got = (await mine(A.db)).data?.[0];
  truthy(
    got?.shown === true && JSON.stringify(got.placements) === JSON.stringify([0, 12345, 0, 2, 7, -99, 1, 0]) && got.lrclib_id === 4242 && !!got.changed_at,
    "lyrics_mine returns them",
  );
  ok(await save(A.db, { p_shown: false, p_placements: [] }), "admin turns it off and clears placements (upsert)");
  truthy((await mine(A.db)).data?.[0]?.shown === false, "off is kept");
  ok(await save(A.db), "admin saves again");

  // --- Owner-only -------------------------------------------------------------------------
  const own = await A.db.from("lyrics_song_prefs").select("user_id").eq("song_id", songId);
  truthy(!own.error && own.data.length === 1 && own.data[0].user_id === A.id, "admin reads their own row");
  const other = await B.db.from("lyrics_song_prefs").select("user_id").eq("song_id", songId);
  truthy(!other.error && other.data.length === 0, "another admin can't read it");
  truthy(((await B.db.rpc("lyrics_mine", { p_slug: slug })).data?.[0]?.shown ?? null) === null, "another admin's lyrics_mine shows only their own (nothing)");
  await B.db.from("lyrics_song_prefs").delete().eq("song_id", songId);
  truthy(((await svc.from("lyrics_song_prefs").select("user_id").eq("song_id", songId)).data ?? []).length === 1, "another admin can't delete it");
  truthy(((await anon.from("lyrics_song_prefs").select("user_id")).data ?? []).length === 0, "signed-out reads nothing");
  refused(await A.db.from("lyrics_song_prefs").insert({ user_id: A.id, song_id: draft.data.id, shown: true }), "no direct inserts (functions only)");
  refused(await A.db.from("lyrics_song_prefs").update({ shown: false }).eq("song_id", songId).select(), "no direct updates");
  truthy((await svc.from("lyrics_song_prefs").select("shown").eq("user_id", A.id).eq("song_id", songId).single()).data?.shown === true, "row unchanged");

  // --- Numbers only -----------------------------------------------------------------------
  refused(await save(A.db, { p_placements: ["line one", 1, 0, 0] }), "words in placements are refused");
  refused(await save(A.db, { p_placements: [0, 1, 0] }), "placements come in fours");
  refused(await save(A.db, { p_placements: [900, 1, 0, 0] }), "line number out of range refused");
  refused(await save(A.db, { p_placements: [0, 1, 0, 500] }), "bar row out of range refused");
  refused(await save(A.db, { p_placements: [0, 1, -1, 0] }), "section nth out of range refused");
  refused(await save(A.db, { p_placements: Array.from({ length: 2004 }, () => 0) }), "too many placements refused");
  refused(await save(A.db, { p_lrclib_id: -5 }), "bad lyrics record id refused");
  refused(await A.db.rpc("lyrics_save_mine", { p_song: draft.data.id, p_shown: true, p_placements: [], p_lrclib_id: null, p_at: null }), "only published songs");
  const cols = Object.keys((await svc.from("lyrics_song_prefs").select("*").eq("song_id", songId).single()).data ?? {});
  truthy(cols.length > 0 && !cols.some((c) => /lyric_text|plain|synced|text|words|line_text/.test(c)), `no lyric text columns (${cols.join(", ")})`);
  const future = await A.db.rpc("lyrics_save_mine", { p_song: songId, p_shown: true, p_placements: [], p_lrclib_id: null, p_at: "2099-01-01T00:00:00Z" });
  truthy(!future.error && new Date(future.data).getFullYear() < 2099, "a future device clock is capped");

  // --- Side panel switch (user_prefs) ------------------------------------------------------
  ok(await A.db.from("user_prefs").upsert({ user_id: A.id, lyrics_panel: true, updated_at: new Date().toISOString() }), "admin saves the side panel switch");
  truthy((await A.db.from("user_prefs").select("lyrics_panel").eq("user_id", A.id).single()).data?.lyrics_panel === true, "side panel switch read back");
  truthy(((await B.db.from("user_prefs").select("lyrics_panel").eq("user_id", A.id)).data ?? []).length === 0, "another player can't read it");

  // --- Kill switch --------------------------------------------------------------------------
  await setAudience(0);
  truthy(((await mine(A.db)).data ?? []).length === 0, "kill switch: lyrics_mine returns nothing");
  refused(await save(A.db), "kill switch: saving refused");
  truthy(((await A.db.from("lyrics_song_prefs").select("user_id").eq("song_id", songId)).data ?? []).length === 1, "kill switch: the owner still sees their own numbers");
  ok(await A.db.from("lyrics_song_prefs").delete().eq("song_id", songId), "the owner can still delete their row");
  truthy(((await svc.from("lyrics_song_prefs").select("user_id").eq("song_id", songId)).data ?? []).length === 0, "row gone");
} catch (e) {
  fail(`crashed: ${e.message ?? e}`);
} finally {
  if (start !== undefined) await svc.from("settings").update({ value: start }).eq("key", "lyrics_audience");
  for (const id of songs) await svc.from("songs").delete().eq("id", id);
  for (const u of users) await svc.auth.admin.deleteUser(u.id);
}
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll lyrics placement checks passed");
process.exit(failed ? 1 : 0);
