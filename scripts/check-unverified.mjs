// Blocker check for the bulk Unverified publish and "Played it, it's right"
// (20261116100000_publish_unverified.sql). Creates throwaway players, an admin and a few
// fake AI drafts, and checks:
//   * only the service role can plan, publish or undo; players and visitors can't
//   * lyric-flagged, duplicate, needs_manual and held drafts are never published
//   * a published draft is live as Unverified, logged (auto_approvals 'bulk' + run id) with a
//     history line, and shows in the review queue's Unverified filter
//   * confirmations: sign-in needed, one per player per chart, tap again takes it back,
//     a new revision starts at 0, only on live Unverified charts, never changes Verified
//   * "Most confirmed first" puts the confirmed chart first
//   * undo sends back only songs still on the published chart; a changed one stays live;
//     an undone song can be published again
// It only ever passes its own fake songs to the publish and undo functions.
// Run: npm run check:unverified   (needs the Supabase keys incl. SUPABASE_SERVICE_ROLE_KEY)
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

async function makeUser(tag) {
  const email = `unverified-check-${tag}-${Date.now()}@example.com`;
  const created = await svc.auth.admin.createUser({ email, email_confirm: true });
  if (created.error) throw created.error;
  const link = await svc.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  const db = createClient(url, anonKey, opts);
  const v = await db.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
  if (v.error) throw v.error;
  return { id: created.data.user.id, db };
}

const stamp = Date.now();
const RUN = `check-${stamp}`;
const CHART = "{title: Unverified Check}\n{key: G}\n[V] 1 4 5 1\n";
const users = [];
const fileIds = [];
const songIds = [];

async function makeDraft(tag, { lyrics = false, reading = "ok", hold = false, dupFile = false } = {}) {
  const title = `zz unverified check ${tag} ${stamp}`;
  const s = await svc.from("songs").insert({ slug: `zz-unverified-check-${tag}-${stamp}`, title, artist: "Check Band", status: "needs_review", review_hold: hold }).select("id").single();
  if (s.error) throw s.error;
  songIds.push(s.data.id);
  const hash = `unverified-check-${tag}-${stamp}`;
  const f = await svc.from("import_files").insert({ dropbox_path: `/zz-check/${hash}.pdf`, content_hash: hash, status: "needs_review", song_id: s.data.id, title, artist: "Check Band" }).select("id").single();
  if (f.error) throw f.error;
  fileIds.push(f.data.id);
  if (dupFile) {
    const d = await svc.from("import_files").insert({ dropbox_path: `/zz-check/${hash}-copy.pdf`, content_hash: `${hash}-copy`, status: "done", title, artist: "Check Band" }).select("id").single();
    if (d.error) throw d.error;
    fileIds.push(d.data.id);
  }
  const v = await svc.from("revisions").insert({ song_id: s.data.id, chart_text: CHART, source: "ai", ai_confidence: 0.62, ai_raw: { has_lyrics: lyrics, notes: "" } }).select("id").single();
  if (v.error) throw v.error;
  const r = await svc.from("ai_readings").insert({ content_hash: hash, import_file_id: f.data.id, mode: "batch", status: reading, model: "check", revision_id: v.data.id, confidence: 0.62 });
  if (r.error) throw r.error;
  const u = await svc.from("songs").update({ current_revision_id: v.data.id }).eq("id", s.data.id);
  if (u.error) throw u.error;
  return { id: s.data.id, revision: v.data.id, title };
}

async function reasons(ids) {
  const out = {};
  for (let offset = 0; ; offset += 500) {
    const r = await svc.rpc("publish_unverified_plan", { p_offset: offset, p_limit: 500 });
    if (r.error) throw r.error;
    for (const row of r.data) if (ids.includes(row.song_id)) out[row.song_id] = row.reason;
    if (r.data.length < 500) break;
  }
  return out;
}
const song = async (id) => (await svc.from("songs").select("status, unverified, verified_at, current_revision_id").eq("id", id).single()).data;

try {
  const player = await makeUser("player");
  const player2 = await makeUser("player2");
  const admin = await makeUser("admin");
  users.push(player, player2, admin);
  const promote = await svc.from("profiles").update({ role: "admin" }).eq("id", admin.id);
  if (promote.error) throw promote.error;

  const good = await makeDraft("good");
  const good2 = await makeDraft("good2", { reading: "ok_after_retry" });
  const lyrics = await makeDraft("lyrics", { lyrics: true });
  const dup = await makeDraft("dup", { dupFile: true });
  const manual = await makeDraft("manual", { reading: "needs_manual" });
  const held = await makeDraft("held", { hold: true });
  const all = [good, good2, lyrics, dup, manual, held].map((d) => d.id);

  // ── who may run it ──
  expectErr(await anon.rpc("publish_unverified_plan", { p_offset: 0, p_limit: 5 }), "visitors can't read the plan");
  expectErr(await admin.db.rpc("publish_unverified_plan", { p_offset: 0, p_limit: 5 }), "even an admin's browser session can't read the plan");
  expectErr(await player.db.rpc("publish_unverified_apply", { p_run: RUN, p_ids: [good.id] }), "players can't publish");
  expectErr(await admin.db.rpc("publish_unverified_apply", { p_run: RUN, p_ids: [good.id] }), "an admin's browser session can't publish");
  expectErr(await admin.db.rpc("publish_unverified_undo", { p_run: RUN, p_dry_run: true }), "an admin's browser session can't undo");
  expectErr(await svc.rpc("publish_unverified_apply", { p_run: "Bad Run!", p_ids: [good.id] }), "a bad run id is refused");

  // ── the rule ──
  const why = await reasons(all);
  check(why[good.id] === null && why[good2.id] === null, "clean drafts (ok, and ok after retry) can be published");
  check(why[lyrics.id] === "lyrics", "a lyric-flagged draft is skipped as 'lyrics'");
  check(why[dup.id] === "duplicate", "a draft sharing title + artist with another file is skipped as 'duplicate'");
  check(why[manual.id] === "needs_manual", "a needs_manual reading is skipped as 'needs_manual'");
  check(why[held.id] === "held", "a held draft is skipped as 'held'");

  const pub = await svc.rpc("publish_unverified_apply", { p_run: RUN, p_ids: all });
  check(!pub.error && pub.data === 2, `publishing all six sends only the two clean ones live (got ${pub.data ?? pub.error?.message})`);
  for (const d of [lyrics, dup, manual, held]) check((await song(d.id)).status === "needs_review", `…${d.title.split(" ")[3]} stays in needs_review`);
  let g = await song(good.id);
  check(g.status === "published" && g.unverified && !g.verified_at, "a published draft is live and Unverified");
  check((await anon.from("songs").select("id").eq("id", good.id)).data?.length === 1, "…and visitors can see it");
  const aa = await svc.from("auto_approvals").select("approved_by, run_id, revision_id, cutoff").eq("song_id", good.id);
  check(aa.data?.length === 1 && aa.data[0].approved_by === "bulk" && aa.data[0].run_id === RUN && aa.data[0].revision_id === good.revision, "logged in auto_approvals as 'bulk' with the run id");
  const hist = await anon.from("verification_log").select("status, reason, by_id").eq("song_id", good.id);
  check(hist.data?.some((l) => l.status === "unverified" && l.by_id === null && !/ai/i.test(l.reason)), "public history line, no person, no mention of AI");
  const again = await svc.rpc("publish_unverified_apply", { p_run: RUN, p_ids: all });
  check(again.data === 0, "running it again publishes nothing new");

  // ── review queue ──
  const q = await admin.db.rpc("review_list", { p_filter: "unverified", p_order: "confirmed", p_q: `unverified check`, p_limit: 50, p_offset: 0 });
  const mine = (q.data?.songs ?? []).filter((s) => all.includes(s.id));
  check(!q.error && mine.length === 2 && mine.every((s) => s.confirmations === 0 && s.auto_approved), "both stay in /admin/review's Unverified filter, with a confirmation count");

  // ── confirmations ──
  const st0 = await anon.rpc("chart_confirm_state", { p_song_id: good.id });
  check(!st0.error && st0.data?.count === 0 && st0.data?.mine === false, "visitors see the count (0)");
  expectErr(await anon.rpc("chart_confirm_toggle", { p_song_id: good.id }), "visitors can't confirm");
  expectErr(await player.db.rpc("chart_confirm_toggle", { p_song_id: lyrics.id }), "a chart that isn't live can't be confirmed");
  let t = await player.db.rpc("chart_confirm_toggle", { p_song_id: good.id });
  check(t.data?.count === 1 && t.data?.mine === true, "a player confirms: count 1, mine");
  t = await player2.db.rpc("chart_confirm_toggle", { p_song_id: good.id });
  check(t.data?.count === 2 && t.data?.mine === true, "a second player confirms: count 2");
  t = await player.db.rpc("chart_confirm_toggle", { p_song_id: good.id });
  check(t.data?.count === 1 && t.data?.mine === false, "tapping again takes it back: count 1");
  t = await player.db.rpc("chart_confirm_toggle", { p_song_id: good.id });
  check(t.data?.count === 2, "one per player: tapping again confirms again, never counts twice");
  const direct = await player.db.from("chart_confirmations").select("user_id");
  check(!!direct.error || direct.data.length === 0, "players can't read the confirmations table directly");
  expectErr(await player.db.from("chart_confirmations").insert({ song_id: good2.id, revision_id: good2.revision, user_id: player.id }), "players can't write confirmations directly");
  g = await song(good.id);
  check(g.unverified && !g.verified_at, "confirming never changes Verified status");
  const q2 = await admin.db.rpc("review_list", { p_filter: "unverified", p_order: "confirmed", p_q: `unverified check`, p_limit: 50, p_offset: 0 });
  const order = (q2.data?.songs ?? []).filter((s) => all.includes(s.id)).map((s) => s.id);
  check(order[0] === good.id && q2.data.songs.find((s) => s.id === good.id).confirmations === 2, "'Most confirmed first' puts the confirmed chart first");
  const next = await admin.db.rpc("review_next", { p_filter: "unverified", p_order: "confirmed", p_skip: [] });
  check(!next.error, "review_next accepts the new order");
  const rs = await admin.db.rpc("review_song", { p_song_id: good.id });
  check(rs.data?.confirmations === 2, "the review screen gets the count");

  // a new revision starts at 0
  const nv = await svc.from("revisions").insert({ song_id: good.id, chart_text: CHART.replace("5 1", "5 5"), source: "human" }).select("id").single();
  if (nv.error) throw nv.error;
  await svc.from("songs").update({ current_revision_id: nv.data.id }).eq("id", good.id);
  const st1 = await anon.rpc("chart_confirm_state", { p_song_id: good.id });
  check(st1.data?.count === 0, "a changed chart starts over at 0 confirmations");

  // ── undo ──
  const dry = await svc.rpc("publish_unverified_undo", { p_run: RUN, p_dry_run: true });
  check(dry.data?.would_unpublish === 1 && dry.data?.left_live === 1 && dry.data?.unpublished === 0, "undo dry run: 1 to send back, the changed one left live, nothing changed");
  check((await song(good2.id)).status === "published", "…the dry run changed nothing");
  const one = await svc.rpc("publish_unverified_undo", { p_run: RUN, p_dry_run: false, p_song_id: good2.id });
  check(one.data?.unpublished === 1, "undo one song");
  check((await song(good2.id)).status === "needs_review", "…it's back in needs_review");
  check((await anon.from("songs").select("id").eq("id", good2.id)).data?.length === 0, "…and hidden from visitors");
  check((await song(good.id)).status === "published", "the changed chart stays live");
  check((await reasons([good2.id]))[good2.id] === null, "a song the undo sent back can be published again");
  const re = await svc.rpc("publish_unverified_apply", { p_run: `${RUN}-b`, p_ids: [good2.id] });
  check(re.data === 1 && (await song(good2.id)).status === "published", "…and a later run publishes it again");
} finally {
  if (fileIds.length) await svc.from("import_files").delete().in("id", fileIds);
  if (songIds.length) await svc.from("songs").delete().in("id", songIds);
  for (const u of users) await svc.auth.admin.deleteUser(u.id);
  console.log(`cleaned up ${users.length} test user(s), ${fileIds.length} fake file(s), ${songIds.length} fake song(s)`);
}
if (failed) {
  console.log(`${failed} check(s) FAILED`);
  process.exit(1);
}
console.log("all bulk-publish and confirmation checks passed");
