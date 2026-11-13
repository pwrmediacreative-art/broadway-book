// Blocker check for the review queue, Unverified publishing and player flags. Creates three
// throwaway users (two players + an admin) and one fake song in needs_review, then checks:
// only admins reach review_*; players can't see the song until it's published; verified
// publishing is blocked while "# UNCLEAR" notes remain; flags are once per player and
// alert admins at the threshold; the AI columns of revisions are hidden. Deletes it all.
// Run: npm run check:review   (needs the Supabase keys incl. SUPABASE_SERVICE_ROLE_KEY)
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
const expectNone = (r, m) => (r.error || r.data.length === 0 ? pass(m) : fail(`${m}: saw ${r.data.length} row(s)`));

async function makeUser(tag) {
  const email = `review-check-${tag}-${Date.now()}@example.com`;
  const created = await svc.auth.admin.createUser({ email, email_confirm: true });
  if (created.error) throw created.error;
  const link = await svc.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  const db = createClient(url, anonKey, opts);
  const v = await db.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
  if (v.error) throw v.error;
  return { id: created.data.user.id, db };
}

const UNCLEAR = "{title: Review Check}\n{key: G}\n# UNCLEAR: V bar 2: 4 or 2-\n[V] 1 4 5 1\n";
const CLEAN = "{title: Review Check}\n{key: G}\n[V] 1 4 5 1\n";
const users = [];
let songId = null;
let alertWas = null;
try {
  const p1 = await makeUser("p1");
  const p2 = await makeUser("p2");
  const a = await makeUser("admin");
  users.push(p1, p2, a);
  const promote = await svc.from("profiles").update({ role: "admin" }).eq("id", a.id);
  if (promote.error) throw promote.error;

  // A fake imported song in needs_review with an AI revision.
  const slug = `review-check-${Date.now()}`;
  const s = await svc.from("songs").insert({ slug, title: "Review Check", artist: "Check Band", status: "needs_review" }).select("id").single();
  if (s.error) throw s.error;
  songId = s.data.id;
  const r = await svc
    .from("revisions")
    .insert({ song_id: songId, chart_text: UNCLEAR, source: "ai", note: "AI reading of x.pdf", ai_confidence: 0.8, ai_raw: { notes: "x" } })
    .select("id")
    .single();
  if (r.error) throw r.error;
  await svc.from("songs").update({ current_revision_id: r.data.id }).eq("id", songId);

  // ── only admins ──
  const calls = {
    review_queue: { p_q: "", p_limit: 5, p_offset: 0 },
    review_song: { p_song_id: songId },
    review_publish: { p_song_id: songId, p_chart: CLEAN, p_verified: true, p_base_revision: r.data.id },
    review_set_hold: { p_song_id: songId, p_hold: true },
    review_dismiss_flags: { p_song_id: songId },
    review_bulk_unverified: { p_max_unclear: 3, p_min_conf: 0, p_dry_run: true },
  };
  for (const [who, db] of [["anon", anon], ["player", p1.db]]) {
    for (const [fn, args] of Object.entries(calls)) expectErr(await db.rpc(fn, args), `${who} ${fn} blocked`);
    expectNone(await db.from("songs").select("id").eq("id", songId), `${who} can't see a needs_review song`);
  }
  expectErr(await anon.rpc("flag_chart", { p_song_id: songId, p_reason: "other", p_details: "" }), "anon can't flag");
  expectErr(await p1.db.rpc("flag_chart", { p_song_id: songId, p_reason: "other", p_details: "" }), "can't flag an unpublished song");
  expectErr(await p1.db.from("chart_flags").insert({ song_id: songId, reason: "other" }), "players can't insert flags directly");

  // ── queue + publish rules ──
  const q = await a.db.rpc("review_queue", { p_q: "Review Check", p_limit: 5, p_offset: 0 });
  check(!q.error && q.data.songs.some((x) => x.id === songId && x.unclear === 1), "admin sees the song in the queue with 1 unclear note");
  const one = await a.db.rpc("review_song", { p_song_id: songId });
  check(!one.error && one.data.chart_text === UNCLEAR && Number(one.data.confidence) === 0.8, "admin review_song returns chart and confidence");
  expectErr(
    await a.db.rpc("review_publish", { p_song_id: songId, p_chart: UNCLEAR, p_verified: true, p_base_revision: r.data.id }),
    "verified publish blocked while # UNCLEAR remains",
  );
  expectErr(
    await a.db.rpc("review_publish", { p_song_id: songId, p_chart: '[V] 1 "and I will always love you baby" 4\n', p_verified: false, p_base_revision: r.data.id }),
    "publish blocked for a long cue (lyrics guard)",
  );
  expectErr(
    await a.db.rpc("review_publish", { p_song_id: songId, p_chart: CLEAN, p_verified: true, p_base_revision: "00000000-0000-0000-0000-000000000000" }),
    "publish blocked when the chart changed underneath",
  );
  const pub = await a.db.rpc("review_publish", { p_song_id: songId, p_chart: UNCLEAR, p_verified: false, p_base_revision: r.data.id });
  check(!pub.error && pub.data === "unverified", "publish as unverified works with notes left");
  const live = await anon.from("songs").select("id, unverified, current_revision_id").eq("id", songId).maybeSingle();
  check(live.data?.unverified === true && live.data.current_revision_id === r.data.id, "anon sees it, marked unverified, same revision (unchanged text)");

  // ── AI columns hidden from players ──
  expectErr(await anon.from("revisions").select("ai_raw").eq("id", r.data.id), "anon can't read revisions.ai_raw");
  expectErr(await p1.db.from("revisions").select("ai_confidence").eq("id", r.data.id), "player can't read revisions.ai_confidence");
  const pubCols = await anon.from("revisions").select("id, chart_text, source, note").eq("id", r.data.id).maybeSingle();
  check(!pubCols.error && pubCols.data?.chart_text === UNCLEAR, "anon can still read the public revision columns");

  // ── flags ──
  const st = await svc.from("settings").select("value").eq("key", "flags_to_alert").single();
  alertWas = st.data.value;
  await svc.from("settings").update({ value: 2 }).eq("key", "flags_to_alert");
  const before = (await svc.from("notifications").select("id", { count: "exact", head: true }).eq("song_id", songId).eq("kind", "flagged")).count;
  const f1 = await p1.db.rpc("flag_chart", { p_song_id: songId, p_reason: "wrong_chords", p_details: "chorus bar 3" });
  check(!f1.error && f1.data === "flagged", "player can flag a published chart");
  const f1b = await p1.db.rpc("flag_chart", { p_song_id: songId, p_reason: "other", p_details: "" });
  check(!f1b.error && f1b.data === "already", "second flag by the same player is ignored");
  expectErr(await p2.db.rpc("flag_chart", { p_song_id: songId, p_reason: "nonsense", p_details: "" }), "bad reason refused");
  const mid = (await svc.from("notifications").select("id", { count: "exact", head: true }).eq("song_id", songId).eq("kind", "flagged")).count;
  check(mid === before, "no alert below the threshold");
  const f2 = await p2.db.rpc("flag_chart", { p_song_id: songId, p_reason: "wrong_key", p_details: "" });
  check(!f2.error && f2.data === "flagged", "second player flags");
  const admins = (await svc.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin")).count;
  const after = (await svc.from("notifications").select("user_id").eq("song_id", songId).eq("kind", "flagged")).data ?? [];
  check(after.length === admins && after.some((n) => n.user_id === a.id), `every admin (${admins}) alerted at the threshold`);
  expectNone(await p1.db.from("chart_flags").select("id").eq("reporter_id", p2.id), "players can't see each other's flags");
  const q2 = await a.db.rpc("review_queue", { p_q: "", p_limit: 1, p_offset: 0 });
  check(!q2.error && q2.data.songs[0]?.id === songId, "flagged song is at the top of the queue");

  // ── verified publish resolves flags ──
  const fresh = await a.db.rpc("review_song", { p_song_id: songId });
  const ver = await a.db.rpc("review_publish", { p_song_id: songId, p_chart: CLEAN, p_verified: true, p_base_revision: fresh.data.revision_id });
  check(!ver.error && ver.data === "verified", "verified publish works once notes are gone");
  const done = await svc.from("songs").select("unverified, current_revision_id").eq("id", songId).single();
  const newRev = await svc.from("revisions").select("source, chart_text").eq("id", done.data.current_revision_id).single();
  check(done.data.unverified === false && newRev.data.source === "human" && newRev.data.chart_text === CLEAN, "new human revision, no longer unverified");
  const open = (await svc.from("chart_flags").select("id", { count: "exact", head: true }).eq("song_id", songId).eq("status", "open")).count;
  check(open === 0, "flags resolved by the verified publish");
} finally {
  if (alertWas !== null) await svc.from("settings").update({ value: alertWas }).eq("key", "flags_to_alert");
  if (songId) await svc.from("songs").delete().eq("id", songId);
  for (const u of users) await svc.auth.admin.deleteUser(u.id);
  console.log(`cleaned up ${users.length} test user(s) and the test song`);
}
if (failed) {
  console.log(`${failed} check(s) FAILED`);
  process.exit(1);
}
console.log("all review checks passed");
