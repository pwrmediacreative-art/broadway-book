// Blocker check for private charts from uploads (20261117100100_private_charts.sql).
// Creates throwaway players and admins and checks, against the real database:
//   * only people the "Audio upload" setting lets in can create charts or upload audio
//     (Admins only / Admins + Pro / Off), enforced by the database, not the UI
//   * a private chart, its revisions, its upload row and its audio are readable by the owner
//     only: not visitors, not other players. Other admins can read an admin's chart and its
//     current version (read, stage, setlists, offline) but never the upload row or audio,
//     and can't edit or share it. A Pro's upload stays private even from admins.
//   * private charts are never in offline_sync() (the offline copy for everyone) or the
//     published song list, and can't get suggestions
//   * nobody can make themselves Pro or change the setting except admins
//   * the share link gives the chart text only (no audio), and stops when turned off
//   * your own private chart goes in your setlists; a shared setlist shows others a placeholder
//   * long cues (lyrics) are refused by the database
// It restores the setting it found and deletes everything it made.
// Run: npm run check:uploads   (needs the Supabase keys incl. SUPABASE_SERVICE_ROLE_KEY)
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
const expectErr = (r, m) => (r.error ? pass(`${m} (${r.error.code ?? r.error.statusCode ?? "error"})`) : fail(`${m}: NOT blocked`));

const stamp = Date.now();
const users = [];
async function makeUser(tag, { admin = false, pro = false } = {}) {
  const email = `uploads-check-${tag}-${stamp}@example.com`;
  const created = await svc.auth.admin.createUser({ email, email_confirm: true });
  if (created.error) throw created.error;
  const id = created.data.user.id;
  users.push(id);
  if (admin || pro) {
    const u = await svc.from("profiles").update({ ...(admin ? { role: "admin" } : {}), ...(pro ? { is_pro: true } : {}) }).eq("id", id);
    if (u.error) throw u.error;
  }
  const link = await svc.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  const db = createClient(url, anonKey, opts);
  const v = await db.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
  if (v.error) throw v.error;
  return { id, db };
}

const CHART = "{title: Uploads Check}\n{key: G} {bpm: 100} {time: 4/4}\n# UNCLEAR: V: label from repeat pattern\n[V] 1 4 5 1\n";
const META = { key: "G", bpm: 100, time: "4/4" };
const create = (db, extra = {}) =>
  db.rpc("upload_create", {
    p_title: `zz uploads check ${stamp}`,
    p_artist: "Check Band",
    p_source: "musicxml",
    p_chart: CHART,
    p_meta: META,
    p_analysis: { version: 1, bars: [] },
    p_confidence: 0.9,
    p_estimated: true,
    ...extra,
  });
const setAccess = (v) => svc.from("settings").update({ value: v }).eq("key", "audio_upload_access");
const AUDIO = new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0x44, 0, 0, 0, 0])], { type: "audio/mpeg" });

const before = await svc.from("settings").select("value").eq("key", "audio_upload_access").single();
if (before.error) throw new Error(`Setting missing: is the migration applied? ${before.error.message}`);
const songs = [];
const files = [];
let setlistId = null;

try {
  await setAccess(1);
  const admin = await makeUser("admin", { admin: true });
  const admin2 = await makeUser("admin2", { admin: true });
  const player = await makeUser("player");
  const pro = await makeUser("pro", { pro: true });

  // ── who may upload ──────────────────────────────────────────────────────────
  check((await admin.db.rpc("upload_access")).data === true, "admin may upload (Admins only)");
  check((await player.db.rpc("upload_access")).data === false, "player may not upload (Admins only)");
  check((await pro.db.rpc("upload_access")).data === false, "Pro may not upload while Admins only");
  expectErr(await anon.rpc("upload_access"), "visitors can't even ask");
  expectErr(await create(player.db), "player can't create a private chart");
  expectErr(await player.db.storage.from("audio").upload(`${player.id}/x.mp3`, AUDIO), "player can't upload audio");

  const made = await create(admin.db);
  check(!made.error && made.data?.id, `admin creates a private chart ${made.error?.message ?? ""}`);
  const song = made.data.id;
  songs.push(song);
  expectErr(await create(admin.db, { p_chart: '{title: X}\n{key: G}\n[V] "one two three four five six seven" 1\n' }), "long cue (lyrics) refused by the database");
  expectErr(await create(admin.db, { p_audio_path: `${player.id}/x.mp3` }), "can't attach someone else's audio path");

  const path = `${admin.id}/${crypto.randomUUID()}.mp3`;
  const up = await admin.db.storage.from("audio").upload(path, AUDIO, { contentType: "audio/mpeg" });
  check(!up.error, `admin uploads audio to their own folder ${up.error?.message ?? ""}`);
  files.push(path);
  expectErr(await admin.db.storage.from("audio").upload(`${admin2.id}/${crypto.randomUUID()}.mp3`, AUDIO, { contentType: "audio/mpeg" }), "can't upload into another person's folder");
  const att = await admin.db.rpc("upload_set_audio", { p_song: song, p_audio_path: path, p_audio_seconds: 1 });
  check(!att.error, `audio attached ${att.error?.message ?? ""}`);

  // ── who can see it ──────────────────────────────────────────────────────────
  const own = await admin.db.from("songs").select("id, status").eq("id", song).maybeSingle();
  check(own.data?.status === "private", "owner reads their private chart");
  const ownRev = await admin.db.from("revisions").select("id").eq("song_id", song);
  check(ownRev.data?.length === 1, "owner reads its revision");
  // other admins: read the chart, nothing else
  check((await admin2.db.from("songs").select("id").eq("id", song).maybeSingle()).data?.id === song, "another admin reads an admin's uploaded chart");
  const rev2 = await admin2.db.from("songs").select("current:revisions!songs_current_revision_fk(chart_text)").eq("id", song).maybeSingle();
  check(!!rev2.data?.current?.chart_text, "another admin reads its current version");
  check(!(await admin2.db.from("uploads").select("song_id").eq("song_id", song)).data?.length, "another admin can't read its upload row");
  const dl2 = await admin2.db.storage.from("audio").download(path);
  check(!!dl2.error || !dl2.data, "another admin can't download the audio");
  const su2 = await admin2.db.storage.from("audio").createSignedUrl(path, 60);
  check(!!su2.error || !su2.data?.signedUrl, "another admin can't make a link to the audio");
  const vis2 = await admin2.db.rpc("upload_charts_visible");
  check((vis2.data ?? []).some((c) => c.id === song && c.mine === false && c.by), "another admin's upload list shows it as someone else's");
  for (const [who, db] of [["visitor", anon], ["player", player.db]]) {
    check(!(await db.from("songs").select("id").eq("id", song).maybeSingle()).data, `${who} can't read the private chart`);
    check(!(await db.from("revisions").select("id").eq("song_id", song)).data?.length, `${who} can't read its revisions`);
    check(!(await db.from("uploads").select("song_id").eq("song_id", song)).data?.length, `${who} can't read its upload row`);
    const dl = await db.storage.from("audio").download(path);
    check(!!dl.error || !dl.data, `${who} can't download the audio`);
    const su = await db.storage.from("audio").createSignedUrl(path, 60);
    check(!!su.error || !su.data?.signedUrl, `${who} can't make a link to the audio`);
  }
  const ownLink = await admin.db.storage.from("audio").createSignedUrl(path, 60);
  check(!!ownLink.data?.signedUrl, "owner gets a short-lived link to their audio");
  const pub = await svc.storage.getBucket("audio");
  check(pub.data?.public === false, "audio bucket is private");

  // ── never in the offline copy, the song list or suggestions ─────────────────
  const slug = (await svc.from("songs").select("slug").eq("id", song).single()).data.slug;
  const off = await anon.rpc("offline_sync", { p_since: null, p_after: "", p_limit: 1 });
  check(!off.error && !(off.data?.slugs ?? []).includes(slug), "not in offline_sync() for visitors");
  const offOwner = await admin.db.rpc("offline_sync", { p_since: null, p_after: "", p_limit: 1 });
  check(!(offOwner.data?.slugs ?? []).includes(slug), "not in offline_sync() for the owner either (own copy is separate)");
  const prop = await player.db.from("proposals").insert({ song_id: song, chart_text: CHART });
  expectErr(prop, "can't suggest an edit on a private chart");
  const mine = await admin.db.rpc("my_private_charts");
  check((mine.data ?? []).some((c) => c.id === song && c.has_audio && !("audio_path" in c)), "owner's list has it, without the audio path");
  check(((await admin2.db.rpc("my_private_charts")).data ?? []).every((c) => c.id !== song), "another admin's own My uploads list doesn't");
  check(((await player.db.rpc("upload_charts_visible")).data ?? []).every((c) => c.id !== song), "a player's upload list doesn't");

  // ── edits ───────────────────────────────────────────────────────────────────
  const save = await admin.db.rpc("private_save", { p_song: song, p_chart: CHART.replace("1 4 5 1", "1 4 5 5"), p_meta: META, p_title: "zz uploads check edited" });
  check(!save.error, `owner saves an edit ${save.error?.message ?? ""}`);
  expectErr(await admin2.db.rpc("private_save", { p_song: song, p_chart: CHART, p_meta: META }), "another admin can't edit it");
  expectErr(await admin2.db.from("songs").update({ title: "hijack" }).eq("id", song).select("id").single(), "another admin can't update the row directly");

  // ── Pro and the setting ─────────────────────────────────────────────────────
  expectErr(await player.db.from("profiles").update({ is_pro: true }).eq("id", player.id).select("id").single(), "player can't make themselves Pro");
  expectErr(await player.db.rpc("set_upload_access", { p_value: 2 }), "player can't change the setting");
  const toPro = await admin.db.rpc("set_upload_access", { p_value: 2 });
  check(!toPro.error, "admin sets Admins + Pro");
  check((await pro.db.rpc("upload_access")).data === true, "Pro may upload (Admins + Pro)");
  check((await player.db.rpc("upload_access")).data === false, "non-Pro player still may not");
  const proMade = await create(pro.db);
  check(!proMade.error, `Pro creates a chart ${proMade.error?.message ?? ""}`);
  if (proMade.data?.id) songs.push(proMade.data.id);
  check(!(await admin.db.from("songs").select("id").eq("id", proMade.data?.id).maybeSingle()).data, "a Pro's upload stays private from admins");
  await admin.db.rpc("set_upload_access", { p_value: 0 });
  check((await admin.db.rpc("upload_access")).data === false, "Off: admins can't upload either");
  expectErr(await create(admin.db), "Off: create refused");
  check(!!(await admin.db.from("songs").select("id").eq("id", song).maybeSingle()).data, "Off: existing chart still there");
  await setAccess(1);

  // ── share link ──────────────────────────────────────────────────────────────
  const code = (await admin.db.rpc("upload_share", { p_song: song, p_on: true })).data;
  check(typeof code === "string" && code.length >= 16, "owner makes a share link");
  const shared = await anon.rpc("upload_shared", { p_code: code });
  check(shared.data?.chart_text?.includes("[V]") && Object.keys(shared.data).sort().join() === "artist,chart_text,title", "share link: title, artist and chart only, no audio");
  expectErr(await player.db.rpc("upload_share", { p_song: song, p_on: true }), "only the owner can share");
  expectErr(await admin2.db.rpc("upload_share", { p_song: song, p_on: true }), "another admin can't share it");
  expectErr(await admin2.db.rpc("upload_delete", { p_song: song }), "another admin can't delete it");
  await admin.db.rpc("upload_share", { p_song: song, p_on: false });
  check(!(await anon.rpc("upload_shared", { p_code: code })).data, "turning sharing off kills the link");

  // ── setlists ────────────────────────────────────────────────────────────────
  const sl = await admin.db.from("setlists").insert({ name: `zz uploads check ${stamp}` }).select("id").single();
  setlistId = sl.data?.id;
  const add = await admin.db.rpc("setlist_add", { p_id: setlistId, p_slug: slug });
  check(!add.error, `owner adds their private chart to a setlist ${add.error?.message ?? ""}`);
  const ownBundle = await admin.db.rpc("setlist_bundle", { p_id: setlistId });
  check(ownBundle.data?.items?.[0]?.song?.chart_text?.includes("[V]"), "owner's setlist plays the chart");
  const sl2 = await admin2.db.from("setlists").insert({ name: `zz uploads check a2 ${stamp}` }).select("id").single();
  check(!(await admin2.db.rpc("setlist_add", { p_id: sl2.data?.id, p_slug: slug })).error, "another admin adds it to his setlist");
  const b2 = await admin2.db.rpc("setlist_bundle", { p_id: sl2.data?.id });
  check(b2.data?.items?.[0]?.song?.chart_text?.includes("[V]"), "and his setlist plays it");
  await admin2.db.from("setlists").delete().eq("id", sl2.data?.id);
  const pl = await player.db.from("setlists").insert({ name: `zz uploads check p ${stamp}` }).select("id").single();
  expectErr(await player.db.rpc("setlist_add", { p_id: pl.data?.id, p_slug: slug }), "player can't add someone's private chart");
  await player.db.from("setlists").delete().eq("id", pl.data?.id);
  const shareCode = (await admin.db.rpc("setlist_share", { p_id: setlistId, p_on: true })).data;
  const other = await anon.rpc("setlist_bundle", { p_code: shareCode });
  const it = other.data?.items?.[0]?.song;
  check(it?.hidden === true && it?.chart_text === null && it?.title === "Private chart", "shared setlist shows others a placeholder, never the chart");

  // ── delete ──────────────────────────────────────────────────────────────────
  const delAudio = await admin.db.rpc("upload_delete_audio", { p_song: song });
  check(delAudio.data === path, "delete audio returns the file to remove");
  const rm = await admin.db.storage.from("audio").remove([path]);
  check(!rm.error, "owner removes the audio file");
  const del = await admin.db.rpc("upload_delete", { p_song: song });
  check(!del.error, "owner deletes the chart");
  check(!(await svc.from("songs").select("id").eq("id", song).maybeSingle()).data, "chart, revisions and upload row are gone");
  check(!(await svc.from("setlist_items").select("id").eq("song_id", song)).data?.length, "and it left the setlist");
} catch (e) {
  fail(`crashed: ${e.message}`);
} finally {
  await setAccess(before.data.value);
  if (setlistId) await svc.from("setlists").delete().eq("id", setlistId);
  if (files.length) await svc.storage.from("audio").remove(files);
  for (const id of songs) await svc.from("songs").delete().eq("id", id);
  for (const id of users) await svc.auth.admin.deleteUser(id);
  const after = await svc.from("settings").select("value").eq("key", "audio_upload_access").single();
  check(after.data?.value === before.data.value, `setting restored to ${before.data.value}`);
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll upload checks passed");
process.exit(failed ? 1 : 0);
