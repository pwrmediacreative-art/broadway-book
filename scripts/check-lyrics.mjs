// Blocker check for lyrics access against the real database: the /admin audience setting
// decides who gets anything (server-side), hide/pick are admin-only and logged, and the
// tables never hold lyric text. Restores the audience setting it started with.
// Run: npm run check:lyrics   (needs SUPABASE_SERVICE_ROLE_KEY)
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

const stamp = Date.now();
async function makeUser(tag) {
  const email = `lyrics-check-${tag}-${stamp}@example.com`;
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
let songId = null;
const start = (await svc.from("settings").select("value").eq("key", "lyrics_audience").single()).data?.value;
try {
  truthy(start !== undefined, `audience setting exists (now ${start})`);
  const slug = `lyrics-check-${stamp}`;
  const s = await svc.from("songs").insert({ slug, title: "Lyrics Check", artist: "Check", status: "published" }).select("id").single();
  if (s.error) throw s.error;
  songId = s.data.id;
  const [P, ADM] = await Promise.all(["player", "admin"].map(makeUser));
  users.push(P, ADM);
  await svc.from("profiles").update({ role: "admin" }).eq("id", ADM.id);

  const allowed = async (db) => (await db.rpc("lyrics_allowed")).data === true;
  const sees = async (db) => ((await db.rpc("lyrics_song", { p_slug: slug })).data ?? []).length === 1;
  const expect = { 0: [false, false, false], 1: [false, false, true], 2: [false, true, true], 3: [true, true, true] };
  for (const level of [0, 1, 2, 3]) {
    ok(await ADM.db.rpc("lyrics_set_audience", { p_value: level }), `admin sets audience ${level}`);
    const got = [await allowed(anon), await allowed(P.db), await allowed(ADM.db)];
    const song = [await sees(anon), await sees(P.db), await sees(ADM.db)];
    truthy(JSON.stringify(got) === JSON.stringify(expect[level]) && JSON.stringify(song) === JSON.stringify(expect[level]), `audience ${level}: signed-out/player/admin = ${got.join("/")}`);
  }
  truthy((await P.db.rpc("lyrics_set_audience", { p_value: 3 })).error, "player can't change the audience");
  truthy((await ADM.db.rpc("lyrics_set_audience", { p_value: 7 })).error, "audience must be 0 to 3");
  truthy((await P.db.rpc("lyrics_set_hidden", { p_song: songId, p_hidden: true })).error, "player can't hide lyrics");
  ok(await ADM.db.rpc("lyrics_set_hidden", { p_song: songId, p_hidden: true }), "admin hides a song's lyrics");
  truthy((await ADM.db.rpc("lyrics_song", { p_slug: slug })).data?.[0]?.hidden === true, "server sees it hidden");
  ok(await ADM.db.rpc("lyrics_set_pick", { p_song: songId, p_lrclib_id: 12345 }), "admin picks a record");
  truthy((await ADM.db.rpc("lyrics_song", { p_slug: slug })).data?.[0]?.lrclib_id === 12345, "server sees the pick");
  truthy((await P.db.rpc("lyrics_set_pick", { p_song: songId, p_lrclib_id: 1 })).error, "player can't pick");
  const log = await ADM.db.from("lyrics_log").select("action, by_id").eq("song_id", songId);
  truthy(log.data?.length === 2 && log.data.every((r) => r.by_id === ADM.id), "hide and pick logged with who");
  const peek = await P.db.from("lyrics_log").select("id").eq("song_id", songId);
  truthy(!peek.error && peek.data.length === 0, "players can't read the log");
  truthy(((await anon.from("lyrics_picks").select("song_id")).data ?? []).length === 0, "signed-out can't read picks");
  const cols = Object.keys((await svc.from("lyrics_picks").select("*").eq("song_id", songId).single()).data ?? {});
  truthy(!cols.some((c) => /lyric_text|plain|synced|text/.test(c)), "no lyric text columns");
} catch (e) {
  fail(`crashed: ${e.message ?? e}`);
} finally {
  if (start !== undefined) await svc.from("settings").update({ value: start }).eq("key", "lyrics_audience");
  if (songId) await svc.from("songs").delete().eq("id", songId);
  for (const u of users) await svc.auth.admin.deleteUser(u.id);
}
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll lyrics checks passed");
process.exit(failed ? 1 : 0);
