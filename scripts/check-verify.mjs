// Blocker check for verified status (database: trigger, RLS, review_verify / review_unverify /
// review_bulk_verify, publish, community merge, revert, history, offline copy).
// Creates throwaway users (an admin, a trusted reviewer, a player) and one throwaway song
// named "zz verification check", then deletes it all.
// Run: npm run check:verify   (needs SUPABASE_SERVICE_ROLE_KEY)
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Set the Supabase keys in .env.local");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const svc = createClient(url, serviceKey, opts);
const anon = createClient(url, anonKey, opts);

let failed = 0;
const check = (ok, m, detail) => {
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", ok || detail === undefined ? m : `${m}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
};
const blocked = (r, m) => check(!!r.error, m, "NOT blocked");
const ok = (r, m) => {
  check(!r.error, m, r.error?.message);
  return r.data;
};

const stamp = Date.now();
async function makeUser(tag, name) {
  const email = `verify-check-${tag}-${stamp}@example.com`;
  const created = await svc.auth.admin.createUser({ email, email_confirm: true });
  if (created.error) throw created.error;
  const link = await svc.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  const db = createClient(url, anonKey, opts);
  const v = await db.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
  if (v.error) throw v.error;
  await svc.from("profiles").update({ display_name: name }).eq("id", created.data.user.id);
  return { id: created.data.user.id, db };
}

const head = "{title: zz verification check}\n{artist: Check Band}\n{key: G}\n";
const AI = `${head}[V] 1 4 5 1\n`;
const EDIT = `${head}[V] 1 4 5 5\n`;
const COMMUNITY = `${head}[V] 1 2- 5 1\n`;
const UNCLEAR = `${head}# UNCLEAR: V bar 2: 4 or 2-\n[V] 1 4 5 1\n`;
const slug = `zz-verification-check-${stamp}`;
const users = [];
let songId = null;

const song = async () => (await svc.from("songs").select("status, unverified, verified_at, verified_by, verified_revision_id, current_revision_id, unverified_since, updated_at").eq("id", songId).single()).data;
const log = async () => (await svc.from("verification_log").select("status, reason, by_id, revision_id").eq("song_id", songId).order("id")).data;
const last = async () => (await log()).at(-1);

try {
  const admin = await makeUser("admin", "Check Admin");
  const reviewer = await makeUser("reviewer", "Check Reviewer");
  const player = await makeUser("player", "Check Player");
  users.push(admin, reviewer, player);
  ok(await svc.from("profiles").update({ role: "admin" }).eq("id", admin.id), "setup: admin role");
  ok(await admin.db.rpc("set_reviewer", { p_user_id: reviewer.id, p_on: true }), "setup: trusted reviewer");

  // A chart waiting for review, as the importer leaves it.
  const s = await svc.from("songs").insert({ slug, title: "zz verification check", artist: "Check Band", status: "needs_review" }).select("id, unverified").single();
  if (s.error) throw s.error;
  songId = s.data.id;
  check(s.data.unverified === true, "a new chart starts Unverified");
  const r0 = await svc.from("revisions").insert({ song_id: songId, chart_text: AI, source: "ai" }).select("id").single();
  if (r0.error) throw r0.error;
  const aiRev = r0.data.id;
  await svc.from("songs").update({ current_revision_id: aiRev }).eq("id", songId);

  // ── who may verify ──
  blocked(await reviewer.db.rpc("review_publish", { p_song_id: songId, p_chart: AI, p_verified: true, p_base_revision: aiRev }), "a trusted reviewer can't publish as verified");
  ok(await reviewer.db.rpc("review_publish", { p_song_id: songId, p_chart: AI, p_verified: false, p_base_revision: aiRev }), "a trusted reviewer can publish (unverified)");
  let cur = await song();
  check(cur.status === "published" && cur.unverified && !cur.verified_at && !!cur.unverified_since, "the reviewer's publish is live and Unverified, with a since-time");
  const pub = await anon.from("songs").select("unverified, verified_at").eq("slug", slug).maybeSingle();
  check(pub.data?.unverified === true && pub.data.verified_at === null, "signed-out visitors see it as Unverified");

  blocked(await reviewer.db.rpc("review_verify", { p_song_id: songId, p_base_revision: aiRev }), "a trusted reviewer can't Verify as is");
  blocked(await player.db.rpc("review_verify", { p_song_id: songId, p_base_revision: aiRev }), "a player can't Verify as is");
  blocked(await anon.rpc("review_verify", { p_song_id: songId, p_base_revision: aiRev }), "a signed-out visitor can't Verify as is");
  blocked(await reviewer.db.rpc("review_bulk_verify", { p_items: [{ id: songId, revision_id: aiRev }] }), "a trusted reviewer can't bulk verify");
  blocked(await player.db.rpc("review_bulk_cards", { p_limit: 20, p_offset: 0 }), "a player can't open the bulk verify cards");
  for (const [who, db] of [["player", player.db], ["reviewer", reviewer.db], ["signed-out visitor", anon]]) {
    await db.from("songs").update({ verified_at: new Date().toISOString(), verified_revision_id: aiRev }).eq("id", songId);
    check(!(await song()).verified_at, `a ${who} can't set verified_at directly on the table`);
    const ins = await db.from("verification_log").insert({ song_id: songId, status: "verified", reason: "fake" });
    check(!!ins.error, `a ${who} can't write to the status history`);
  }
  check((await log()).length === 0, "nothing was logged by the refused attempts");

  // ── Verify as is / Mark unverified ──
  const before = cur.updated_at;
  ok(await admin.db.rpc("review_verify", { p_song_id: songId, p_base_revision: aiRev }), "an admin can Verify as is");
  cur = await song();
  check(!!cur.verified_at && cur.verified_by === admin.id && cur.verified_revision_id === aiRev && cur.unverified === false && cur.unverified_since === null, "Verified: when, who and which revision are stored");
  check(Date.parse(cur.updated_at) > Date.parse(before), "verifying moves updated_at (phones pick it up)");
  let l = await last();
  check(l.status === "verified" && l.reason === "Checked against the original" && l.by_id === admin.id && l.revision_id === aiRev, "history: Verified, by the admin, with the reason");
  const hist = await anon.from("verification_log").select("status, reason").eq("song_id", songId);
  check(hist.data?.length === 1, "signed-out visitors can read the status history of a live chart");
  const sync = await anon.rpc("offline_sync", { p_since: new Date(Date.now() - 60_000).toISOString() });
  const row = sync.data?.songs?.find((x) => x.slug === slug);
  check(!!row && row.unverified === false && !!row.verified_at, "the phone's saved copy carries the verified status and date");

  blocked(await reviewer.db.rpc("review_unverify", { p_song_id: songId, p_reason: "mistake" }), "a trusted reviewer can't Mark unverified");
  blocked(await admin.db.rpc("review_unverify", { p_song_id: songId, p_reason: "because" }), "Mark unverified needs one of the three reasons");
  ok(await admin.db.rpc("review_unverify", { p_song_id: songId, p_reason: "mistake" }), "an admin can Mark unverified");
  cur = await song();
  l = await last();
  check(!cur.verified_at && !cur.verified_by && !cur.verified_revision_id && cur.unverified && !!cur.unverified_since, "Mark unverified clears it");
  check(l.status === "unverified" && l.reason === "Verified by mistake" && l.by_id === admin.id, "history: Unverified, by the admin, 'Verified by mistake'");

  // ── Publish (verified) with an edit ──
  let n = (await log()).length;
  ok(await admin.db.rpc("review_publish", { p_song_id: songId, p_chart: EDIT, p_verified: true, p_base_revision: aiRev }), "an admin publishes an edit as verified");
  cur = await song();
  const editRev = cur.current_revision_id;
  check(editRev !== aiRev && cur.verified_revision_id === editRev && !!cur.verified_at, "Publish (verified) verifies the new revision");
  check((await log()).length === n + 1 && (await last()).status === "verified", "history: one Verified row, no stray Unverified row");

  // ── community merge (approved instantly by an admin) ──
  const prop = await player.db.from("proposals").insert({ song_id: songId, chart_text: COMMUNITY, note: "band plays 2-", base_revision_id: editRev }).select("id").single();
  if (prop.error) throw prop.error;
  ok(await admin.db.rpc("admin_decide", { p_id: prop.data.id, p_approve: true }), "an admin approves a community edit");
  cur = await song();
  l = await last();
  const communityRev = cur.current_revision_id;
  check(communityRev !== editRev && !cur.verified_at && cur.unverified, "a merged community edit puts the chart back to Unverified (even admin-approved)");
  check(l.status === "unverified" && l.reason === "Community edit merged" && l.revision_id === communityRev, "history: Unverified, 'Community edit merged'");

  // ── revert ──
  const revs = await svc.from("revisions").select("id, chart_text").eq("song_id", songId);
  const editRow = revs.data.find((x) => x.id === editRev);
  check(!!editRow, "setup: the verified revision is still in history");
  ok(await admin.db.rpc("revert_song", { p_song_id: songId, p_revision_id: editRev }), "an admin reverts to the version that was verified");
  cur = await song();
  l = await last();
  check(!!cur.verified_at && cur.verified_revision_id === cur.current_revision_id, "reverting to a verified version restores Verified");
  check(l.status === "verified" && l.reason === "Reverted to a checked version", "history: Verified, 'Reverted to a checked version'");
  ok(await admin.db.rpc("revert_song", { p_song_id: songId, p_revision_id: communityRev }), "an admin reverts to a version that was never verified");
  cur = await song();
  l = await last();
  check(!cur.verified_at && cur.unverified, "reverting to an unchecked version is Unverified");
  check(l.status === "unverified" && l.reason === "Reverted to a version that was not checked", "history: Unverified, 'Reverted to a version that was not checked'");

  // ── bulk verify ──
  const cards = ok(await admin.db.rpc("review_bulk_cards", { p_limit: 20, p_offset: 0 }), "an admin can open the bulk verify cards");
  const card = cards?.cards?.find((c) => c.id === songId);
  check(!!card && card.chart_text === COMMUNITY && card.revision_id === cur.current_revision_id, "a bulk card shows the live chart text and revision");
  const stale = ok(await admin.db.rpc("review_bulk_verify", { p_items: [{ id: songId, revision_id: aiRev }] }), "bulk verify with an out-of-date card runs");
  check(stale?.verified === 0 && stale.skipped?.[0]?.why === "changed since it was shown" && !(await song()).verified_at, "bulk verify skips a chart that changed since it was shown");
  blocked(await admin.db.rpc("review_bulk_verify", { p_items: Array.from({ length: 21 }, () => ({ id: songId, revision_id: cur.current_revision_id })) }), "bulk verify refuses more than 20 at once");
  const bulk = ok(await admin.db.rpc("review_bulk_verify", { p_items: [{ id: songId, revision_id: cur.current_revision_id }] }), "an admin bulk verifies");
  l = await last();
  check(bulk?.verified === 1 && !!(await song()).verified_at && l.reason === "Checked against the original (bulk)" && l.by_id === admin.id, "bulk verify marks Verified and logs who and when");

  // ── unclear notes, examples, wrong revision ──
  cur = await song();
  ok(await reviewer.db.rpc("review_publish", { p_song_id: songId, p_chart: UNCLEAR, p_verified: false, p_base_revision: cur.current_revision_id }), "a reviewer's edit is published");
  cur = await song();
  l = await last();
  check(!cur.verified_at && l.status === "unverified" && l.reason === "Chart edited" && l.by_id === reviewer.id, "a reviewer's edit puts a verified chart back to Unverified, logged");
  blocked(await admin.db.rpc("review_verify", { p_song_id: songId, p_base_revision: cur.current_revision_id }), "a chart with an UNCLEAR note can't be verified");
  blocked(await admin.db.rpc("review_bulk_verify", { p_items: [] }), "bulk verify needs at least one chart");
  const unclearBulk = await admin.db.rpc("review_bulk_verify", { p_items: [{ id: songId, revision_id: cur.current_revision_id }] });
  check(unclearBulk.data?.verified === 0 && unclearBulk.data.skipped?.[0]?.why === "has unclear notes", "bulk verify skips a chart with unclear notes");
  const ex = await svc.from("songs").select("id, current_revision_id, unverified").eq("is_example", true).eq("status", "published").limit(1).maybeSingle();
  if (ex.data) {
    check(ex.data.unverified === false, "example songs carry no Unverified flag");
    blocked(await admin.db.rpc("review_verify", { p_song_id: ex.data.id, p_base_revision: ex.data.current_revision_id }), "an example song can't be verified");
    await svc.from("review_claims").delete().eq("song_id", ex.data.id).eq("user_id", admin.id);
  }
  blocked(await svc.from("songs").update({ verified_at: new Date().toISOString(), verified_revision_id: aiRev }).eq("id", songId).select("id"), "verification can never point at a revision that isn't live");

  // ── queue, counts, progress ──
  const list = ok(await admin.db.rpc("review_list", { p_filter: "unverified", p_order: "title", p_q: "zz verification", p_limit: 10, p_offset: 0 }), "the Unverified filter lists");
  check(list?.songs?.some((x) => x.id === songId) && typeof list.counts.unverified === "number" && typeof list.counts.verified === "number", "the Unverified filter shows the chart, with Verified / Unverified counts");
  const vlist = await admin.db.rpc("review_list", { p_filter: "verified", p_order: "title", p_q: "zz verification", p_limit: 10, p_offset: 0 });
  check(vlist.data?.songs?.length === 0, "the Verified filter doesn't list an unverified chart");
  const prog = ok(await admin.db.rpc("review_progress"), "progress loads");
  const me = prog?.people?.find((p) => p.me);
  check(!!me && me.total === 3 && me.today === 3, "per-admin count: 3 verifies (as is, publish, bulk), all today", me);
  check(Array.isArray(prog?.oldest) && typeof prog.waiting === "number" && typeof prog.verified === "number", "progress carries the oldest-unverified list and the waiting count");
  check(!prog.people.some((p) => p.name === "Check Reviewer"), "a reviewer's unverified publish isn't counted as a verify");
} catch (e) {
  failed++;
  console.log("FAIL (crashed)", e.message ?? e);
} finally {
  if (songId) {
    const d = await svc.from("songs").delete().eq("id", songId);
    if (d.error) console.log(`CLEANUP FAILED: delete song ${slug} by hand (${d.error.message})`);
  }
  for (const u of users) {
    const d = await svc.auth.admin.deleteUser(u.id);
    if (d.error) console.log(`CLEANUP FAILED: delete user ${u.id}`);
  }
  console.log("cleanup done");
}
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll verification checks passed");
process.exit(failed ? 1 : 0);
