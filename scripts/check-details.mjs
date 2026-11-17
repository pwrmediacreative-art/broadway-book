// Blocker check for Song details "+ Add…" (20261118220000_song_detail_adds.sql +
// 20261118220100_song_detail_adds_tighten.sql), against the real database. Creates
// throwaway admins and a player and checks:
//   * the owner saves a detail instantly (song_details_save) and it's logged once per detail
//   * a save that changes nothing makes no revision and counts nothing
//   * section fields beyond the chart's sections, unknown fields and too many fields are refused
//   * there is no log-only path (song_details_log is gone)
//   * another admin can add a detail to an admin's upload (new revision, title unchanged)
//   * other players and visitors can't save or read anything
//   * each player reads only their own count; rows can't be written directly
// It restores the upload setting it found and deletes everything it made.
// Run: npm run check:details   (needs the Supabase keys incl. SUPABASE_SERVICE_ROLE_KEY)
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Set the Supabase keys in .env.local");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const svc = createClient(url, serviceKey, opts);
const anon = createClient(url, anonKey, opts);

let failed = 0;
const pass = (m) => console.log("PASS", m);
const fail = (m) => {
  failed++;
  console.log("FAIL", m);
};
const check = (ok, m) => (ok ? pass(m) : fail(m));
const expectErr = (r, m) => (r.error ? pass(`${m} (${r.error.code ?? "error"})`) : fail(`${m}: NOT blocked`));

const stamp = Date.now();
const users = [];
async function makeUser(tag, { admin = false } = {}) {
  const email = `details-check-${tag}-${stamp}@example.com`;
  const created = await svc.auth.admin.createUser({ email, email_confirm: true });
  if (created.error) throw created.error;
  const id = created.data.user.id;
  users.push(id);
  if (admin) {
    const u = await svc.from("profiles").update({ role: "admin" }).eq("id", id);
    if (u.error) throw u.error;
  }
  const link = await svc.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  const db = createClient(url, anonKey, opts);
  const v = await db.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
  if (v.error) throw v.error;
  return { id, db };
}

const TITLE = `zz details check ${stamp}`;
const CHART = "{title: Details Check}\n{key: G} {time: 4/4}\n# UNCLEAR: start: how the song starts isn't in the file\n[V] 1 4 5 1\n";
const STARTED = "{title: Details Check}\n{key: G} {time: 4/4}\n# ADDED BY A PLAYER: start\n[V] \"count off\" 1 4 5 1\n";
const ENDED = "{title: Details Check}\n{key: G} {time: 4/4}\n# ADDED BY A PLAYER: start\n# ADDED BY A PLAYER: ending\n[V] \"count off\" 1 4 5 1 \"cold stop\"\n";
const META = { key: "G", bpm: null, time: "4/4" };
const count = async (u) => (await u.db.from("song_detail_adds").select("field", { count: "exact", head: true })).count;
const live = async (song) =>
  (await svc.from("songs").select("title, current:revisions!songs_current_revision_fk(chart_text, author_id)").eq("id", song).single()).data;
const setAccess = (v) => svc.from("settings").update({ value: v }).eq("key", "audio_upload_access");

const before = await svc.from("settings").select("value").eq("key", "audio_upload_access").single();
if (before.error) throw new Error(`Setting missing: ${before.error.message}`);
const table = await svc.from("song_detail_adds").select("field").limit(1);
if (table.error) throw new Error(`song_detail_adds missing: is the migration applied? ${table.error.message}`);
const songs = [];

try {
  await setAccess(1);
  const owner = await makeUser("owner", { admin: true });
  const admin2 = await makeUser("admin2", { admin: true });
  const player = await makeUser("player");

  const made = await owner.db.rpc("upload_create", {
    p_title: TITLE,
    p_artist: null,
    p_source: "musicxml",
    p_chart: CHART,
    p_meta: META,
    p_analysis: { version: 1, bars: [] },
    p_confidence: 0.9,
    p_estimated: false,
  });
  if (made.error) throw made.error;
  const song = made.data.id;
  songs.push(song);

  // owner: instant save + log
  const r1 = await owner.db.rpc("song_details_save", { p_song: song, p_chart: STARTED, p_meta: META, p_fields: ["start"] });
  check(!r1.error, `owner saves a detail${r1.error ? `: ${r1.error.message}` : ""}`);
  check((await live(song))?.current?.chart_text === STARTED, "the saved chart is live");
  check((await count(owner)) === 1, "owner's count is 1");
  const revs = async () => (await svc.from("revisions").select("id", { count: "exact", head: true }).eq("song_id", song)).count;
  const n = await revs();
  const again = await owner.db.rpc("song_details_save", { p_song: song, p_chart: STARTED, p_meta: META, p_fields: ["solo:0"] });
  check(!again.error && (await revs()) === n && (await count(owner)) === 1, "a save that changes nothing adds no revision and counts nothing");

  // fields must fit the chart (CHART has 1 section)
  const MORE = STARTED.replace("[V]", "[V] {feel: half time}");
  expectErr(await owner.db.rpc("song_details_save", { p_song: song, p_chart: MORE, p_meta: META, p_fields: ["solo:1"] }), "a section field beyond the chart's sections is refused");
  expectErr(await owner.db.rpc("song_details_save", { p_song: song, p_chart: MORE, p_meta: META, p_fields: ["bogus"] }), "an unknown field is refused");
  expectErr(
    await owner.db.rpc("song_details_save", { p_song: song, p_chart: MORE, p_meta: META, p_fields: ["start", "ending", "solo:0", "stop:0", "key:0", "solo:00"] }),
    "more fields than the chart can have are refused",
  );
  check((await live(song))?.current?.chart_text === STARTED && (await count(owner)) === 1, "refused saves change nothing");

  // no log-only path
  expectErr(await owner.db.rpc("song_details_log", { p_song: song, p_fields: ["ending"] }), "song_details_log no longer exists");

  // another admin on an admin's upload
  const r2 = await admin2.db.rpc("song_details_save", { p_song: song, p_chart: ENDED, p_meta: META, p_fields: ["ending"] });
  check(!r2.error, `another admin adds a detail${r2.error ? `: ${r2.error.message}` : ""}`);
  const after = await live(song);
  check(after?.current?.chart_text === ENDED && after?.current?.author_id === admin2.id, "their revision is live, by them");
  check(after?.title === TITLE, "title unchanged on the admin path");
  check((await count(admin2)) === 1 && (await count(owner)) === 1, "each player counts their own");

  // nobody else
  expectErr(await player.db.rpc("song_details_save", { p_song: song, p_chart: CHART, p_meta: META, p_fields: ["start"] }), "a player can't add to someone's private chart");
  expectErr(await anon.rpc("song_details_save", { p_song: song, p_chart: CHART, p_meta: META, p_fields: [] }), "a visitor can't save");
  check((await live(song))?.current?.chart_text === ENDED, "the chart is unchanged");
  const peek = await player.db.from("song_detail_adds").select("field").eq("song_id", song);
  check(!peek.error && peek.data.length === 0, "a player can't read others' rows");
  const an = await anon.from("song_detail_adds").select("field").limit(1);
  check(!!an.error || an.data.length === 0, "a visitor reads nothing");
  expectErr(await player.db.from("song_detail_adds").insert({ song_id: song, field: "start" }), "rows can't be written directly");
  expectErr(await owner.db.from("song_detail_adds").delete().eq("song_id", song).select("field").single(), "rows can't be deleted directly");

  // long cues (lyrics) still refused
  const lyric = "{title: Details Check}\n{key: G} {time: 4/4}\n[V] \"one two three four five six seven\" 1 4 5 1\n";
  expectErr(await owner.db.rpc("song_details_save", { p_song: song, p_chart: lyric, p_meta: META, p_fields: [] }), "long cues refused (owner)");
  expectErr(await admin2.db.rpc("song_details_save", { p_song: song, p_chart: lyric, p_meta: META, p_fields: [] }), "long cues refused (admin path)");
} catch (e) {
  fail(`crashed: ${e.message ?? e}`);
} finally {
  await setAccess(before.data.value);
  for (const id of songs) await svc.from("songs").delete().eq("id", id);
  for (const id of users) await svc.auth.admin.deleteUser(id);
}
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll details checks passed");
process.exit(failed ? 1 : 0);
