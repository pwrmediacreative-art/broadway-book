// Blocker check for player-made charts (20261119120000_made_charts.sql, Q16).
// Creates throwaway players, an admin and a library song and checks, against the real database:
//   * any signed-in player can make a chart (not gated by the upload setting); visitors can't
//   * a made chart is private: only its owner reads the song, its revisions and its
//     made_charts row; not other players, not visitors; never in offline_sync() or the
//     published list; the owner gets it from upload_charts_visible() marked made
//   * only the owner saves or deletes it; long boxed notes / repeat notes (lyrics) are refused;
//     a chart with no key saves with no key
//   * "Send to library" locks it: chart_save, private_save, rename, upload_delete and
//     chart_delete all refuse, update_proposal refuses, a second send refuses; other signed-in
//     players see it in Community by its sent name (sent_name, not out of date) but still can't
//     read its song row, revisions or slug (setlist_add); visitors see nothing; the author can't vote
//   * a waiting chart counts as one of the open suggestions (max_open_proposals)
//   * withdraw unlocks it (saves work again); 3 rejections close it and it stays private
//   * 3 approvals from other players publish it: library song, Unverified, no owner, public
//     slug (the private one redirects), made_charts row gone, the creator can't save any more;
//     its public history is only the approved version (autosaves stay private drafts, no
//     revert to them); a chart with no {key:} but a key change inside keeps no key
//   * same title + artist as a library song: an admin's "Approve now" makes a separate entry
//     with version_of + "Version by <display name>" (version_line); library_key offers its key
// It restores the setting it changes and deletes everything it made.
// Run: npm run check:charts   (needs the Supabase keys incl. SUPABASE_SERVICE_ROLE_KEY)
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
const songs = [];
async function makeUser(tag, { admin = false, name = null } = {}) {
  const email = `charts-check-${tag}-${stamp}@example.com`;
  const created = await svc.auth.admin.createUser({ email, email_confirm: true });
  if (created.error) throw created.error;
  const id = created.data.user.id;
  users.push(id);
  if (admin || name) {
    const u = await svc.from("profiles").update({ ...(admin ? { role: "admin" } : {}), ...(name ? { display_name: name } : {}) }).eq("id", id);
    if (u.error) throw u.error;
  }
  const link = await svc.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  const db = createClient(url, anonKey, opts);
  const v = await db.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
  if (v.error) throw v.error;
  return { id, db };
}

const TITLE = `zz charts check ${stamp}`;
const chartText = (title, body = "", key = "{key: E} {bpm: 91} {time: 4/4}") =>
  `{title: ${title}}\n{artist: Check Band}\n${key}\n${body}`;
const BODY = `[V] 1 (4 1) 5 5 | 5 5\n[C] |: 1 (4 1) 1 (4 1) :|"repeat out"\n[B] b7 b7 4 4 | 5 5 1 1 {mod: +5} "[Mod ↑ P.4th (1 becomes 5)]"\n["Big ending"] 1 4 5 1\n`;
const create = (db, title = TITLE, body = BODY, key) =>
  db.rpc("chart_create", { p_title: title, p_artist: "Check Band", p_chart: chartText(title, body, key) });
const save = (db, id, body, title = TITLE) => db.rpc("chart_save", { p_song: id, p_chart: chartText(title, body), p_title: title, p_artist: "Check Band" });
const vote = (u, id, value) => u.db.from("votes").insert({ proposal_id: id, voter_id: u.id, value });
const song = async (id) =>
  (await svc.from("songs").select("slug, status, owner_id, unverified, key, version_of, version_by, current_revision_id").eq("id", id).single()).data;

const setting = await svc.from("settings").select("value").eq("key", "max_open_proposals").single();
if (setting.error) throw new Error(`settings missing: ${setting.error.message}`);
const access = await svc.from("settings").select("value").eq("key", "audio_upload_access").single();

try {
  const ok = await svc.from("made_charts").select("song_id").limit(1);
  if (ok.error) throw new Error(`Is the migration applied? ${ok.error.message}`);
  if (!access.error) await svc.from("settings").update({ value: 1 }).eq("key", "audio_upload_access"); // uploads: admins only

  const maker = await makeUser("maker", { name: "Check Maker" });
  const other = await makeUser("other");
  const [v1, v2, v3] = await Promise.all(["v1", "v2", "v3"].map((t) => makeUser(t)));
  const admin = await makeUser("admin", { admin: true });

  // ── create ──────────────────────────────────────────────────────────────────
  check((await maker.db.rpc("upload_access")).data === false, "the maker can't upload (uploads stay admins only)");
  expectErr(await create(anon), "visitors can't make a chart");
  const made = await create(maker.db);
  check(!made.error && made.data?.id, `any signed-in player makes a chart ${made.error?.message ?? ""}`);
  const id = made.data?.id;
  const privSlug = made.data?.slug;
  songs.push(id);
  const s0 = await song(id);
  check(s0?.status === "private" && s0?.owner_id === maker.id && s0?.key === "E", "it is a private song owned by the maker, key from the header");

  const noKey = await create(maker.db, `${TITLE} nokey`, "[V] 1 4 5 1\n", "{time: 3/4}");
  songs.push(noKey.data?.id);
  check(!noKey.error && (await song(noKey.data?.id))?.key === null, "a chart with no key saves with no key");

  // ── private ─────────────────────────────────────────────────────────────────
  check(!!(await maker.db.from("songs").select("id").eq("id", id).maybeSingle()).data, "the owner reads it");
  check(!(await other.db.from("songs").select("id").eq("id", id).maybeSingle()).data, "another player can't read it");
  check(!(await anon.from("songs").select("id").eq("id", id).maybeSingle()).data, "visitors can't read it");
  check(!(await other.db.from("revisions").select("id").eq("song_id", id)).data?.length, "another player can't read its revisions");
  check(!(await other.db.from("made_charts").select("song_id").eq("song_id", id)).data?.length, "another player can't read its made_charts row");
  const vis = await maker.db.rpc("upload_charts_visible");
  const mine = (vis.data ?? []).find((c) => c.id === id);
  check(mine?.made === true && mine?.locked === false && mine?.chart_text?.includes('["Big ending"]'), "upload_charts_visible() gives it to the owner, marked made");
  check(!((await other.db.rpc("upload_charts_visible")).data ?? []).some((c) => c.id === id), "not in another player's list");
  const off = await anon.rpc("offline_sync", { p_since: null, p_after: "", p_limit: 1 });
  check(!off.error && !(off.data?.slugs ?? []).includes(privSlug), "not in offline_sync()");
  check(!(await anon.from("songs").select("id").eq("slug", privSlug).eq("status", "published")).data?.length, "not in the published list");

  // ── save / delete ───────────────────────────────────────────────────────────
  const saved = await save(maker.db, id, BODY + "[Tag] 1 1\n");
  check(!saved.error, `the owner saves ${saved.error?.message ?? ""}`);
  expectErr(await save(other.db, id, BODY), "another player can't save it");
  expectErr(await save(maker.db, id, `[V] "[one two three four five six seven]" 1\n`), "a boxed note over 6 words is refused");
  expectErr(await save(maker.db, id, `[V] 1 :|"one two three four five six seven"\n`), "a repeat note over 6 words is refused");
  expectErr(await other.db.rpc("chart_delete", { p_song: id }), "another player can't delete it");

  // ── send to library: lock ───────────────────────────────────────────────────
  expectErr(await other.db.rpc("chart_submit", { p_song: id, p_note: "" }), "another player can't send it");
  const sub = await maker.db.rpc("chart_submit", { p_song: id, p_note: "" });
  check(!sub.error && sub.data, `the owner sends it to the library ${sub.error?.message ?? ""}`);
  const P1 = sub.data;
  check((await svc.from("proposals").select("kind").eq("id", P1).single()).data?.kind === "new_song", "it is a new-song suggestion");
  expectErr(await maker.db.rpc("chart_submit", { p_song: id, p_note: "" }), "it can't be sent twice");
  expectErr(await save(maker.db, id, BODY), "locked: chart_save refuses");
  expectErr(
    await maker.db.rpc("private_save", { p_song: id, p_chart: chartText(TITLE, BODY), p_meta: { key: "E" } }),
    "locked: private_save refuses",
  );
  expectErr(await maker.db.rpc("rename_song", { p_song: id, p_title: `${TITLE} renamed`, p_artist: "Check Band" }), "locked: rename refuses");
  expectErr(await maker.db.rpc("upload_delete", { p_song: id }), "locked: upload_delete refuses");
  expectErr(await maker.db.rpc("chart_delete", { p_song: id }), "locked: chart_delete refuses");
  expectErr(await maker.db.rpc("update_proposal", { p_id: P1, p_chart: chartText(TITLE, BODY), p_note: "change" }), "locked: the suggestion text can't be changed");
  check(((await maker.db.rpc("upload_charts_visible")).data ?? []).find((c) => c.id === id)?.locked === true, "upload_charts_visible() says locked");
  const seen = await other.db.from("songs").select("id").eq("id", id);
  check(!seen.error && !seen.data?.length, "its song row stays private (songs RLS isn't widened)");
  const listed = await other.db.from("proposals").select("id, out_of_date, sent_name, song:songs(title)").eq("id", P1).maybeSingle();
  check(
    !listed.error && listed.data?.sent_name?.title === TITLE && listed.data?.song === null && listed.data?.out_of_date === false,
    `Community lists it for players by its sent name, not out of date ${listed.error?.message ?? ""}`,
  );
  check(!(await anon.from("proposals").select("id").eq("id", P1).maybeSingle()).data, "visitors don't see it");
  const revs = await other.db.from("revisions").select("id").eq("song_id", id);
  check(!revs.error && !revs.data?.length, "its revisions stay private");
  const add = await other.db.rpc("setlist_add", { p_id: crypto.randomUUID(), p_slug: privSlug });
  check(/song not found/i.test(add.error?.message ?? ""), "other players can't find it by slug for a setlist");
  expectErr(await other.db.rpc("_chart_locked", { p_song: id }), "_chart_locked is internal");
  expectErr(await vote(maker, P1, "approve"), "the author can't vote");

  // ── counts as an open suggestion ────────────────────────────────────────────
  await svc.from("settings").update({ value: 1 }).eq("key", "max_open_proposals");
  const second = await create(maker.db, `${TITLE} two`, "[V] 1 4\n");
  songs.push(second.data?.id);
  expectErr(await maker.db.rpc("chart_submit", { p_song: second.data?.id, p_note: "" }), "with 1 open suggestion allowed, a second send is refused");
  await svc.from("settings").update({ value: setting.data.value }).eq("key", "max_open_proposals");

  // ── withdraw unlocks ────────────────────────────────────────────────────────
  check(!(await maker.db.rpc("chart_withdraw", { p_song: id })).error, "the owner withdraws it");
  check(!(await save(maker.db, id, BODY)).error, "unlocked: saving works again");
  check(!(await other.db.from("songs").select("id").eq("id", id).maybeSingle()).data, "private again: other players can't read it");

  // ── 3 rejections close it ───────────────────────────────────────────────────
  const P2 = (await maker.db.rpc("chart_submit", { p_song: id, p_note: "again" })).data;
  for (const u of [v1, v2, v3]) await vote(u, P2, "reject");
  check((await svc.from("proposals").select("status").eq("id", P2).single()).data?.status === "rejected", "3 rejections close it");
  const s2 = await song(id);
  check(s2?.status === "private" && s2?.owner_id === maker.id, "closed: it stays private to the maker");
  check(!(await save(maker.db, id, BODY)).error, "closed: unlocked again");

  // ── 3 approvals publish it ──────────────────────────────────────────────────
  const P3 = (await maker.db.rpc("chart_submit", { p_song: id, p_note: "new song" })).data;
  for (const u of [v1, v2, v3]) await vote(u, P3, "approve");
  const p3 = (await svc.from("proposals").select("status, resulting_revision_id").eq("id", P3).single()).data;
  check(p3?.status === "approved", "3 approvals from other players approve it");
  const s3 = await song(id);
  check(s3?.status === "published" && s3?.owner_id === null && s3?.unverified === true, "it is a library song, Unverified, with no owner");
  check(s3?.slug === `zz-charts-check-${stamp}-check-band`, `it gets a public slug (${s3?.slug})`);
  check(s3?.current_revision_id === p3?.resulting_revision_id, "its live revision is the approved one");
  check(!!(await anon.from("songs").select("id").eq("slug", s3?.slug).eq("status", "published").maybeSingle()).data, "visitors can read it now");
  check((await anon.rpc("resolve_slug", { p_slug: privSlug })).data === s3?.slug, "the private address redirects");
  check(!(await svc.from("made_charts").select("song_id").eq("song_id", id)).data?.length, "its made_charts row is gone");
  expectErr(await save(maker.db, id, BODY), "the creator can't save it any more (Suggest a change from now on)");
  check(s3?.version_of === null, "no library song had its name: not a version");
  const pubRevs = await anon.from("revisions").select("id").eq("song_id", id);
  check(
    !pubRevs.error && pubRevs.data?.length === 1 && pubRevs.data[0].id === p3?.resulting_revision_id,
    "its public history holds only the approved version, never the private drafts",
  );
  const drafts = (await svc.from("revisions").select("id").eq("song_id", id).eq("private_draft", true)).data ?? [];
  check(drafts.length > 0, "the autosaved versions are kept as private drafts");
  const adminRevs = await admin.db.from("revisions").select("id").eq("song_id", id);
  check(!adminRevs.error && adminRevs.data?.length === 1, "admins don't read the private drafts either");
  expectErr(await admin.db.rpc("revert_song", { p_song_id: id, p_revision_id: drafts[0]?.id }), "an admin can't revert to a private draft");

  // ── no key in the header + a key change inside: the song keeps no key ────────
  const keyless = await create(maker.db, `${TITLE} keyless`, "[V] 1 4 5 1\n{key: A}\n[C] 1 5 6- 4\n", "{time: 4/4}");
  songs.push(keyless.data?.id);
  const P5 = (await maker.db.rpc("chart_submit", { p_song: keyless.data?.id, p_note: "no key" })).data;
  check(!(await admin.db.rpc("admin_decide", { p_id: P5, p_approve: true })).error, "an admin approves a chart with no key");
  check((await song(keyless.data?.id))?.key === null, "approved, a chart with no {key:} keeps no key (not the inline key change)");

  // ── same title + artist: a separate version ─────────────────────────────────
  const twin = await create(other.db, TITLE, "[V] 1 5 6- 4\n", "{key: G} {time: 4/4}");
  songs.push(twin.data?.id);
  check((await other.db.rpc("library_key", { p_title: TITLE, p_artist: "check band" })).data === "E", "library_key offers the library song's key");
  const P4 = (await other.db.rpc("chart_submit", { p_song: twin.data?.id, p_note: "my version" })).data;
  expectErr(await other.db.rpc("admin_decide", { p_id: P4, p_approve: true }), "a player can't approve it now");
  check(!(await admin.db.rpc("admin_decide", { p_id: P4, p_approve: true })).error, "an admin approves it now");
  const s4 = await song(twin.data?.id);
  check(s4?.status === "published" && s4?.version_of === id && s4?.version_by === other.id, "it is a separate entry pointing at the original");
  check(s4?.slug && s4.slug !== s3?.slug, `with its own slug (${s4?.slug})`);
  const line = (await anon.from("songs").select("version_line").eq("id", twin.data?.id).single()).data?.version_line;
  check(line === "Version by a player", `no display name: "${line}"`);
  await svc.from("profiles").update({ display_name: "Check Other" }).eq("id", other.id);
  const line2 = (await anon.from("songs").select("version_line").eq("id", twin.data?.id).single()).data?.version_line;
  check(line2 === "Version by Check Other", `with a display name: "${line2}"`);
  check((await anon.from("songs").select("version_line").eq("id", id).single()).data?.version_line === null, "the original has no version line");
} catch (e) {
  fail(`crashed: ${e.message}`);
} finally {
  await svc.from("settings").update({ value: setting.data.value }).eq("key", "max_open_proposals");
  if (!access.error) await svc.from("settings").update({ value: access.data.value }).eq("key", "audio_upload_access");
  const ids = songs.filter(Boolean);
  if (ids.length) {
    await svc.from("proposals").delete().in("song_id", ids); // unlock before deleting
    await svc.from("songs").update({ version_of: null }).in("id", ids);
    for (const sid of ids) await svc.from("songs").delete().eq("id", sid);
  }
  for (const uid of users) await svc.auth.admin.deleteUser(uid);
  check((await svc.from("settings").select("value").eq("key", "max_open_proposals").single()).data?.value === setting.data.value, "setting restored");
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll made-chart checks passed");
process.exit(failed ? 1 : 0);
