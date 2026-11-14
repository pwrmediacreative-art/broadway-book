// Blocker check for auto-approve (20261114100000_auto_approve.sql). Creates a throwaway
// admin and player and a handful of fake Dropbox files, saves fake AI readings for them
// through the real ai_finish(), and checks:
//   * a chart at or under the cutoff, not saved as 'ok', with any unclear note, with a
//     long cue, after a technical failure, or sharing its title and artist with another
//     file is NEVER published
//   * nothing is published while the switch is off
//   * an auto-approved chart is always live as Unverified, with an auto_approvals row
//     (approved_by = 'auto', score, cutoff) and an "Automatic" line in its public history
//   * a chart that was sent back is never auto-approved again
//   * only admins reach the controls; players can't read auto_approvals; cutoff 50 to 99
// It flips the real settings for a few seconds and puts them back. It only ever COUNTS
// with the two bulk actions (dry run), so it can't publish or pull back real charts.
// It refuses to run while a real AI run is in flight.
// Run: npm run check:auto   (needs the Supabase keys incl. SUPABASE_SERVICE_ROLE_KEY)
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
  const email = `auto-check-${tag}-${Date.now()}@example.com`;
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
const CLEAN = "{title: Auto Check}\n{key: G}\n[V] 1 4 5 1\n";
const UNCLEAR = "{title: Auto Check}\n{key: G}\n# UNCLEAR: V bar 2: 4 or 2-\n[V] 1 4 5 1\n";
const LYRIC = '{title: Auto Check}\n{key: G}\n[V] 1 "and I will always love you baby" 4\n';
const KEYS = ["auto_approve_enabled", "auto_approve_min_confidence", "auto_approve_max_unclear"];

const users = [];
const fileIds = [];
const songIds = new Set();
let before = null; // the real settings, put back at the end

const setSettings = async (enabled, cutoff, unclear = 0) => {
  for (const [key, value] of [[KEYS[0], enabled], [KEYS[1], cutoff], [KEYS[2], unclear]]) {
    const r = await svc.from("settings").update({ value }).eq("key", key);
    if (r.error) throw r.error;
  }
};

try {
  const open = await svc.from("ai_readings").select("id", { count: "exact", head: true }).in("status", ["reserved", "submitted"]);
  if (open.error) throw open.error;
  if (open.count) throw new Error(`${open.count} AI reading(s) are in flight. Run this when no AI run is going.`);

  const s0 = await svc.from("settings").select("key, value").in("key", KEYS);
  if (s0.error || s0.data.length !== 3) throw new Error("auto-approve settings missing: apply the migration first");
  before = Object.fromEntries(s0.data.map((r) => [r.key, r.value]));
  check(true, `settings exist (switch is ${before[KEYS[0]] === 1 ? "ON" : "off"}, cutoff ${before[KEYS[1]]}%, unclear spots allowed ${before[KEYS[2]]})`);

  const player = await makeUser("player");
  const admin = await makeUser("admin");
  users.push(player, admin);
  const promote = await svc.from("profiles").update({ role: "admin" }).eq("id", admin.id);
  if (promote.error) throw promote.error;

  // A fake PDF in the inventory (as a Dropbox scan leaves it), then its reading saved
  // through the real ai_finish(), as in a real run. Fake readings cost $0.
  let n = 0;
  async function scan(title) {
    n++;
    const f = await svc
      .from("import_files")
      .insert({ dropbox_path: `/auto-check/${stamp}-${n}.pdf`, content_hash: `auto-check-${stamp}-${n}`, file_name: `${stamp}-${n}.pdf`, title, artist: "Auto Check Band" })
      .select("id, content_hash")
      .single();
    if (f.error) throw f.error;
    fileIds.push(f.data.id);
    return f.data;
  }
  async function finish(file, { status = "ok", confidence, chart = CLEAN, failures = 0 }) {
    const r = await svc.from("ai_readings").insert({ content_hash: file.content_hash, import_file_id: file.id, mode: "batch", model: "check", failures }).select("id").single();
    if (r.error) throw r.error;
    const fin = await admin.db.rpc("ai_finish", {
      p_id: r.data.id,
      p_status: status,
      p_result: { cost_usd: 0, input_tokens: 0, output_tokens: 0, confidence, unclear: [], chart_text: chart, raw: { notes: "check" } },
    });
    if (fin.error) throw fin.error;
    const row = await svc.from("import_files").select("song_id, status").eq("id", file.id).single();
    if (row.data?.song_id) songIds.add(row.data.song_id);
    const song = row.data?.song_id
      ? (await svc.from("songs").select("id, slug, status, unverified, current_revision_id").eq("id", row.data.song_id).single()).data
      : null;
    return { result: fin.data, song, fileStatus: row.data?.status };
  }
  const t = (name) => `Auto Check ${stamp} ${name}`;
  const read = async (name, o) => finish(await scan(t(name)), o);
  const notLive = (x, m) => check(x.song?.status !== "published", `${m} (song is ${x.song?.status ?? "not made"}, file ${x.fileStatus})`);
  const count = async (fn) => {
    const r = await admin.db.rpc(fn, { p_dry_run: true });
    if (r.error) throw r.error;
    return Number(r.data);
  };
  const statusOf = async (id) => (await svc.from("songs").select("status").eq("id", id).single()).data.status;

  // ── only admins ──
  for (const [who, db] of [["anon", anon], ["player", player.db]]) {
    expectErr(await db.rpc("auto_approve_overview"), `${who} auto_approve_overview blocked`);
    expectErr(await db.rpc("auto_approve_set", { p_enabled: true, p_min_confidence: 50 }), `${who} auto_approve_set blocked`);
    expectErr(await db.rpc("auto_approve_existing", { p_dry_run: false }), `${who} auto_approve_existing blocked`);
    expectErr(await db.rpc("auto_approve_pull_back", { p_dry_run: false }), `${who} auto_approve_pull_back blocked`);
    expectErr(await db.rpc("auto_approve_revert", { p_song_id: "00000000-0000-0000-0000-000000000000" }), `${who} auto_approve_revert blocked`);
    for (const fn of ["auto_approve_candidates", "auto_approved_songs"]) expectErr(await db.rpc(fn), `${who} ${fn} (internal) blocked`);
    expectErr(await db.rpc("auto_approve_publish", { p_ids: [] }), `${who} auto_approve_publish (internal) blocked`);
    expectErr(await db.rpc("auto_approve_unpublish", { p_ids: [] }), `${who} auto_approve_unpublish (internal) blocked`);
  }
  const after = await svc.from("settings").select("key, value").in("key", KEYS);
  check(after.data.every((r) => before[r.key] === r.value), "the blocked calls changed no setting");
  for (const fn of ["auto_approve_candidates", "auto_approved_songs"]) expectErr(await admin.db.rpc(fn), `even an admin can't call ${fn} directly`);
  expectErr(await admin.db.rpc("auto_approve_set", { p_enabled: false, p_min_confidence: 49 }), "cutoff under 50 is refused");
  expectErr(await admin.db.rpc("auto_approve_set", { p_enabled: false, p_min_confidence: 100 }), "cutoff over 99 is refused");
  expectErr(await admin.db.rpc("auto_approve_set", { p_enabled: false, p_min_confidence: 75, p_max_unclear: 11 }), "unclear limit over 10 is refused");
  const okU = await admin.db.rpc("auto_approve_set", { p_enabled: false, p_min_confidence: 75, p_max_unclear: 3 });
  const sU = await svc.from("settings").select("value").eq("key", KEYS[2]).single();
  check(!okU.error && sU.data.value === 3, "an admin changes the unclear-spot limit without code (set to 3)");
  const ok80 = await admin.db.rpc("auto_approve_set", { p_enabled: before[KEYS[0]] === 1, p_min_confidence: 80 });
  const s80 = await svc.from("settings").select("value").eq("key", KEYS[1]).single();
  check(!ok80.error && s80.data.value === 80, "an admin changes the cutoff without code (set to 80)");
  const offRpc = await admin.db.rpc("auto_approve_set", { p_enabled: false, p_min_confidence: 75 });
  const sOff = await svc.from("settings").select("value").eq("key", KEYS[0]).single();
  check(!offRpc.error && sOff.data.value === 0, "BLOCKER an admin switches auto-approve off without code");

  // ── switch OFF: nothing is published, however good the score ──
  await setSettings(0, 75);
  const base = await count("auto_approve_existing");
  const off = await read("off", { confidence: 0.95 });
  notLive(off, "BLOCKER switch off: a 0.95 clean chart is not published");
  check((await count("auto_approve_existing")) === base + 1, "…but it is counted as a draft that would pass");
  expectErr(await admin.db.rpc("auto_approve_existing", { p_dry_run: false }), "BLOCKER switch off: the existing-drafts action refuses to publish");
  check((await statusOf(off.song.id)) === "needs_review", "…and the draft is still in needs_review");
  // Hold it, so from here on the candidate count is back to where it started.
  await svc.from("songs").update({ review_hold: true }).eq("id", off.song.id);
  check((await count("auto_approve_existing")) === base, "a draft on hold is not a candidate");

  // ── switch ON: what must stay in review ──
  await setSettings(1, 75);
  notLive(await read("at", { confidence: 0.75 }), "BLOCKER exactly at the cutoff (0.75) is not published");
  notLive(await read("under", { confidence: 0.6 }), "BLOCKER under the cutoff (0.60) is not published");
  notLive(await read("retry", { confidence: 0.95, status: "ok_after_retry" }), "needed a parser retry: not published");
  notLive(await read("unclear", { confidence: 0.95, chart: UNCLEAR }), "one unclear note: not published");
  notLive(await read("failed", { confidence: 0.95, failures: 1 }), "a reading re-sent after a technical failure: not published");
  const lyric = await read("lyric", { confidence: 0.95, chart: LYRIC });
  check(lyric.result === "needs_manual", "BLOCKER a chart with a long cue is refused by ai_finish (needs_manual)");
  notLive(lyric, "…and is not published");
  notLive(await read("manual", { confidence: 0.95, status: "needs_manual" }), "BLOCKER a reading that failed the parser (needs_manual) is not published");
  // Two files with the same title and artist, both in the inventory before either is read.
  const dupA = await scan(t("dup"));
  const dupB = await scan(t("dup"));
  notLive(await finish(dupA, { confidence: 0.95 }), "first of two files with the same title and artist is not published");
  notLive(await finish(dupB, { confidence: 0.95 }), "second of two files with the same title and artist is not published");
  check((await count("auto_approve_existing")) === base, "none of those drafts is a candidate for the existing-drafts action either");

  // ── switch ON: what goes live ──
  const live0 = await count("auto_approve_pull_back");
  const good = await read("good", { confidence: 0.76 });
  check(good.song?.status === "published", "just over the cutoff (0.76), clean, first try: published with no admin action");
  check(good.song?.unverified === true, "BLOCKER the auto-approved chart is Unverified");
  const rec = await svc.from("auto_approvals").select("approved_by, confidence, cutoff, approved_at, run_by").eq("revision_id", good.song.current_revision_id).single();
  check(
    rec.data?.approved_by === "auto" && Number(rec.data.confidence) === 0.76 && Number(rec.data.cutoff) === 0.75 && Boolean(rec.data.approved_at) && rec.data.run_by === admin.id,
    "auto_approvals records approved_by = auto, score 0.76, cutoff 0.75, who ran it",
  );
  const hist = await anon.from("verification_log").select("status, reason, by_id").eq("song_id", good.song.id);
  check(
    !hist.error && hist.data.some((h) => h.status === "unverified" && h.by_id === null && /published automatically/i.test(h.reason)),
    "the public history has the 'Published automatically' line, with no person",
  );
  const pub = await anon.from("songs").select("slug, unverified").eq("id", good.song.id).maybeSingle();
  check(pub.data?.unverified === true, "BLOCKER a signed-out player sees it, marked unverified");
  expectErr(await anon.from("auto_approvals").select("id"), "anon can't read auto_approvals");
  expectErr(await player.db.from("auto_approvals").select("confidence, cutoff"), "player can't read auto_approvals");
  expectErr(await admin.db.from("auto_approvals").insert({ song_id: good.song.id, revision_id: good.song.current_revision_id, confidence: 1, cutoff: 0.5 }), "nobody writes auto_approvals through the API");
  check((await count("auto_approve_pull_back")) === live0 + 1, "it is counted as auto-approved");
  const sync = await anon.rpc("offline_sync", { p_since: null, p_after: "", p_limit: 500 });
  check(!sync.error && sync.data.slugs.includes(good.song.slug), "it is in the offline sync list");
  const list = await admin.db.rpc("review_list", { p_filter: "auto_approved", p_order: "title", p_q: t("good"), p_limit: 5, p_offset: 0 });
  check(!list.error && list.data.songs.some((x) => x.id === good.song.id && x.auto_approved === true), "the Auto-approved filter lists it with its badge");
  check(!list.error && Number.isInteger(list.data.counts.auto_approved) && Number.isInteger(list.data.counts.verified), "the queue returns auto-approved and verified counts");
  const one = await admin.db.rpc("review_song", { p_song_id: good.song.id });
  check(!one.error && one.data.auto_approved === true && Number(one.data.auto_cutoff) === 0.75, "the review screen is told it is auto-approved, with the cutoff");

  // ── a second one; a stricter cutoff unpublishes nothing ──
  const loose = await read("second", { confidence: 0.95 });
  check(loose.song?.status === "published" && loose.song.unverified === true, "a 0.95 clean chart goes live, Unverified");
  // ── the unclear-spot limit ──
  const UNCLEAR2 = UNCLEAR.replace("# UNCLEAR: V bar 2: 4 or 2-\n", "# UNCLEAR: V bar 2: 4 or 2-\n# UNCLEAR: V bar 3: 5 or 5/7\n");
  await setSettings(1, 75, 1);
  const one1 = await read("one-unclear", { confidence: 0.95, chart: UNCLEAR });
  check(one1.song?.status === "published" && one1.song.unverified === true, "limit 1: a chart with one unclear spot goes live, Unverified");
  notLive(await read("two-unclear", { confidence: 0.95, chart: UNCLEAR2 }), "BLOCKER limit 1: a chart with two unclear spots is not published");
  notLive(await read("one-unclear-low", { confidence: 0.75, chart: UNCLEAR }), "BLOCKER limit 1: one unclear spot at exactly the cutoff is not published");
  await setSettings(1, 99);
  check((await statusOf(one1.song.id)) === "published", "lowering the limit back to 0 unpublishes nothing");
  check((await statusOf(good.song.id)) === "published" && (await statusOf(loose.song.id)) === "published", "a stricter cutoff unpublishes nothing");

  // ── switching off stops new ones, keeps live ones ──
  await setSettings(0, 75);
  const off2 = await read("off2", { confidence: 0.95 });
  notLive(off2, "BLOCKER switched off again: a new 0.95 chart is not published");
  check((await statusOf(good.song.id)) === "published", "…and the chart already live stays live");
  await svc.from("songs").update({ review_hold: true }).eq("id", off2.song.id);

  // ── send one back; it never comes back on its own ──
  expectErr(await player.db.rpc("auto_approve_revert", { p_song_id: good.song.id }), "player can't send a chart back");
  const back = await admin.db.rpc("auto_approve_revert", { p_song_id: good.song.id });
  const reverted = await svc.from("songs").select("status, current_revision_id").eq("id", good.song.id).single();
  check(!back.error && reverted.data.status === "needs_review" && reverted.data.current_revision_id === good.song.current_revision_id, "admin revert: back in needs_review, same revision");
  check((await anon.from("songs").select("id").eq("id", good.song.id)).data?.length === 0, "…and players can't see it any more");
  check((await count("auto_approve_pull_back")) === live0 + 2, "…and it no longer counts as auto-approved (the second and one-unclear charts still do)");
  check((await count("auto_approve_existing")) === base, "a chart that was sent back is not a candidate again, though its score still passes");
  expectErr(await admin.db.rpc("auto_approve_revert", { p_song_id: good.song.id }), "reverting it twice is refused");

  // ── verifying one ends "auto-approved" ──
  const ver = await admin.db.rpc("review_publish", { p_song_id: loose.song.id, p_chart: CLEAN, p_verified: true, p_base_revision: loose.song.current_revision_id });
  check(!ver.error && ver.data === "verified", "a reviewer can fix and verify an auto-approved chart");
  check((await count("auto_approve_pull_back")) === live0 + 1, "…and then it is no longer auto-approved, so Pull back leaves it alone");
} finally {
  if (before) for (const k of KEYS) await svc.from("settings").update({ value: before[k] }).eq("key", k);
  if (fileIds.length) {
    const linked = await svc.from("import_files").select("song_id").in("id", fileIds);
    for (const r of linked.data ?? []) if (r.song_id) songIds.add(r.song_id);
    await svc.from("import_files").delete().in("id", fileIds);
  }
  if (songIds.size) await svc.from("songs").delete().in("id", [...songIds]);
  for (const u of users) await svc.auth.admin.deleteUser(u.id);
  const left = await svc.from("settings").select("key, value").in("key", KEYS);
  const restored = before && (left.data ?? []).every((r) => before[r.key] === r.value);
  console.log(`cleaned up ${users.length} test user(s), ${fileIds.length} fake file(s), ${songIds.size} fake song(s); settings ${restored ? "put back" : "NOT put back: check /admin/import"}`);
}
if (failed) {
  console.log(`${failed} check(s) FAILED`);
  process.exit(1);
}
console.log("all auto-approve checks passed");
