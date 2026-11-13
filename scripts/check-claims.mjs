// Blocker check for the review screen (claims, drafts, trusted reviewers, can't read,
// duplicates, progress). Creates throwaway users (two admins, a reviewer, a player) and
// fake songs + import files, then checks:
//   * two people can never hold the same song (also when they claim at the same instant)
//   * Publish makes the song visible to signed-out visitors
//   * edits made in review become a new revision and the AI revision is kept
//   * drafts never make a revision; only reviewers/admins reach review_*; admin-only stays admin-only
// Deletes it all. Run: npm run check:claims   (needs SUPABASE_SERVICE_ROLE_KEY)
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

const stamp = Date.now();
async function makeUser(tag, name) {
  const email = `review-co-${tag}-${stamp}@example.com`;
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

const AI = "{title: Claim Check}\n{artist: Check Band}\n{key: G}\n# UNCLEAR: V bar 2: 4 or 2-\n[V] 1 4 5 1\n";
const FIXED = "{title: Claim Check}\n{artist: Check Band}\n{key: G}\n[V] 1 2- 5 1\n";
const users = [];
const songs = [];
const files = [];

async function makeSong(n, title = `Claim Check ${n}`, artist = "Check Band") {
  const s = await svc
    .from("songs")
    .insert({ slug: `claim-check-${stamp}-${n}`, title, artist, status: "needs_review", dropbox_path: `/__review-check/${stamp}-${n}.pdf` })
    .select("id")
    .single();
  if (s.error) throw s.error;
  songs.push(s.data.id);
  const r = await svc
    .from("revisions")
    .insert({ song_id: s.data.id, chart_text: AI, source: "ai", note: "AI reading", ai_confidence: 0.9, ai_raw: {} })
    .select("id")
    .single();
  if (r.error) throw r.error;
  await svc.from("songs").update({ current_revision_id: r.data.id }).eq("id", s.data.id);
  const f = await svc
    .from("import_files")
    .insert({ dropbox_path: `/__review-check/${stamp}-${n}.pdf`, file_name: `${title}.pdf`, title, artist, status: "needs_review", song_id: s.data.id })
    .select("id")
    .single();
  if (f.error) throw f.error;
  files.push(f.data.id);
  return { id: s.data.id, rev: r.data.id, file: f.data.id };
}

try {
  const a = await makeUser("a", "Check Admin A");
  const b = await makeUser("b", "Check Admin B");
  const rv = await makeUser("r", "Check Reviewer");
  const p = await makeUser("p", "Check Player");
  users.push(a, b, rv, p);
  for (const u of [a, b]) {
    const up = await svc.from("profiles").update({ role: "admin" }).eq("id", u.id);
    if (up.error) throw up.error;
  }
  const s1 = await makeSong(1);
  const s2 = await makeSong(2);
  const s3 = await makeSong(3);
  const d1 = await makeSong(4, "Claim Check Dup");
  const d2 = await makeSong(5, "Claim Check Dup");

  // ── who can reach review_* ──
  const calls = {
    review_claim: { p_song_id: s1.id },
    review_song: { p_song_id: s1.id },
    review_save_draft: { p_song_id: s1.id, p_chart: FIXED, p_base_revision: s1.rev },
    review_publish: { p_song_id: s1.id, p_chart: FIXED, p_verified: true, p_base_revision: s1.rev },
    review_cant_read: { p_song_id: s1.id },
    review_next: { p_filter: "needs_review", p_order: "conf_desc", p_skip: [] },
    review_list: { p_filter: "needs_review", p_order: "conf_desc", p_q: "", p_limit: 5, p_offset: 0 },
    review_progress: {},
    review_pdf_ref: { p_file_id: s1.file },
    set_reviewer: { p_user_id: p.id, p_on: true },
  };
  for (const [who, db] of [["anon", anon], ["player", p.db]]) {
    for (const [fn, args] of Object.entries(calls)) expectErr(await db.rpc(fn, args), `${who} ${fn} blocked`);
  }
  const self = await p.db.from("profiles").update({ reviewer: true }).eq("id", p.id).select("reviewer");
  const selfRow = await svc.from("profiles").select("reviewer").eq("id", p.id).single();
  check((self.error || !self.data?.length) && selfRow.data.reviewer === false, "a player can't make themselves a reviewer");

  // ── trusted reviewer ──
  expectErr(await rv.db.rpc("set_reviewer", { p_user_id: rv.id, p_on: true }), "a non-admin can't grant reviewer");
  const grant = await a.db.rpc("set_reviewer", { p_user_id: rv.id, p_on: true });
  check(!grant.error, "admin grants reviewer");
  const rl = await rv.db.rpc("review_list", { p_filter: "needs_review", p_order: "title", p_q: "Claim Check", p_limit: 20, p_offset: 0 });
  check(!rl.error && rl.data.songs.some((x) => x.id === s1.id), "reviewer sees the queue");
  for (const [fn, args] of Object.entries({
    review_mark_duplicate: { p_song_id: d1.id },
    review_bulk_unverified: { p_max_unclear: 3, p_min_conf: 0, p_dry_run: true },
    review_set_hold: { p_song_id: s3.id, p_hold: true },
    review_dismiss_flags: { p_song_id: s3.id },
  }))
    expectErr(await rv.db.rpc(fn, args), `reviewer ${fn} blocked (admin-only)`);

  // ── claims ──
  const ca = await a.db.rpc("review_claim", { p_song_id: s1.id });
  check(!ca.error && ca.data.mine === true, "admin A claims song 1");
  const cb = await b.db.rpc("review_claim", { p_song_id: s1.id });
  check(!cb.error && cb.data.mine === false && cb.data.by === "Check Admin A", "admin B is told A is reviewing song 1");
  expectErr(await b.db.rpc("review_save_draft", { p_song_id: s1.id, p_chart: FIXED, p_base_revision: s1.rev }), "B can't save a draft on A's song");
  expectErr(await b.db.rpc("review_publish", { p_song_id: s1.id, p_chart: FIXED, p_verified: true, p_base_revision: s1.rev }), "B can't publish A's song");
  expectErr(await b.db.rpc("review_cant_read", { p_song_id: s1.id }), "B can't mark A's song can't-read");
  const lb = await b.db.rpc("review_list", { p_filter: "needs_review", p_order: "title", p_q: "Claim Check", p_limit: 20, p_offset: 0 });
  const row = (id) => lb.data?.songs.find((x) => x.id === id);
  check(!lb.error && row(s1.id)?.claimed_name === "Check Admin A" && row(s1.id)?.claimed_by_me === false, "queue shows B that A is reviewing song 1");
  check(!lb.error && row(s3.id) && row(s3.id).claimed_name === null && row(s3.id).claim_expires === null, "queue shows nobody on an unclaimed song");
  const nb = await b.db.rpc("review_next", { p_filter: "needs_review", p_order: "title", p_skip: [] });
  check(!nb.error && nb.data !== s1.id, "auto-advance never hands B the song A holds");

  const race = await Promise.all([a.db.rpc("review_claim", { p_song_id: s2.id }), b.db.rpc("review_claim", { p_song_id: s2.id })]);
  const winners = race.filter((r) => !r.error && r.data.mine).length;
  check(winners === 1, `simultaneous claims: exactly one wins (got ${winners})`);
  const holder = (await svc.from("review_claims").select("user_id").eq("song_id", s2.id)).data ?? [];
  check(holder.length === 1, "one claim row per song");

  await svc.from("review_claims").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("song_id", s1.id);
  const late = await b.db.rpc("review_claim", { p_song_id: s1.id });
  check(!late.error && late.data.mine === true, "after A's claim expires, B can claim song 1");
  const back = await a.db.rpc("review_claim", { p_song_id: s1.id });
  check(!back.error && back.data.mine === false, "…and then A can't take it back");
  await b.db.rpc("review_release", { p_song_id: s1.id });
  const again = await a.db.rpc("review_claim", { p_song_id: s1.id });
  check(!again.error && again.data.mine === true, "B releases; A claims song 1 again");

  // ── drafts ──
  const revCount = async (id) => (await svc.from("revisions").select("id", { count: "exact", head: true }).eq("song_id", id)).count;
  const dr = await a.db.rpc("review_save_draft", { p_song_id: s1.id, p_chart: FIXED, p_base_revision: s1.rev });
  check(!dr.error, "A saves a draft");
  expectErr(
    await a.db.rpc("review_save_draft", { p_song_id: s1.id, p_chart: '[V] 1 "and I will always love you baby" 4\n', p_base_revision: s1.rev }),
    "draft with a long cue refused (no lyrics)",
  );
  const withDraft = await a.db.rpc("review_song", { p_song_id: s1.id });
  check(!withDraft.error && withDraft.data.draft?.chart_text === FIXED && withDraft.data.draft.by === "Check Admin A", "review_song returns the draft and who saved it");
  check((await revCount(s1.id)) === 1, "saving a draft made no revision");
  expectNone(await anon.from("songs").select("id").eq("id", s1.id), "song 1 still hidden from signed-out visitors");

  // ── publish ──
  const pub = await a.db.rpc("review_publish", { p_song_id: s1.id, p_chart: FIXED, p_verified: true, p_base_revision: s1.rev });
  check(!pub.error && pub.data === "verified", "A publishes song 1 (verified)");
  const live = await anon.from("songs").select("id, status, unverified, current_revision_id").eq("id", s1.id).maybeSingle();
  check(live.data?.status === "published" && live.data.unverified === false, "signed-out visitors can see song 1 after Publish");
  const liveRev = await anon.from("revisions").select("chart_text, source").eq("id", live.data?.current_revision_id).maybeSingle();
  check(liveRev.data?.chart_text === FIXED && liveRev.data.source === "human" && live.data.current_revision_id !== s1.rev, "the edited chart is a new revision");
  const aiKept = await svc.from("revisions").select("chart_text, source").eq("id", s1.rev).single();
  check(aiKept.data?.chart_text === AI && aiKept.data.source === "ai" && (await revCount(s1.id)) === 2, "the AI revision is kept");
  const log = (await svc.from("review_log").select("user_id, action").eq("song_id", s1.id)).data ?? [];
  check(log.length === 1 && log[0].user_id === a.id && log[0].action === "verified", "review log records A as the reviewer");
  const left = await svc.from("review_claims").select("song_id").eq("song_id", s1.id);
  const leftDraft = await svc.from("review_drafts").select("song_id").eq("song_id", s1.id);
  check(!left.data?.length && !leftDraft.data?.length, "publishing releases the claim and clears the draft");
  const file1 = await svc.from("import_files").select("status").eq("id", s1.file).single();
  check(file1.data.status === "done", "the import file is marked done");

  // ── flags: reviewers don't see flaggers' names ──
  await p.db.rpc("flag_chart", { p_song_id: s1.id, p_reason: "wrong_chords", p_details: "bar 2" });
  const asR = await rv.db.rpc("review_song", { p_song_id: s1.id });
  const asA = await a.db.rpc("review_song", { p_song_id: s1.id });
  check(!asR.error && asR.data.flags[0]?.reason === "wrong_chords" && asR.data.flags[0].by === null, "reviewer sees the flag reason, not who flagged");
  check(!asA.error && asA.data.flags[0]?.by === "Check Player", "admin sees who flagged");

  // ── reviewer: can't read, then type it and publish unverified ──
  const rc = await rv.db.rpc("review_claim", { p_song_id: s3.id });
  check(!rc.error && rc.data.mine, "reviewer claims song 3");
  const cr = await rv.db.rpc("review_cant_read", { p_song_id: s3.id });
  check(!cr.error, "reviewer marks song 3 can't read");
  const s3row = await svc.from("songs").select("status, current_revision_id").eq("id", s3.id).single();
  const f3 = await svc.from("import_files").select("status").eq("id", s3.file).single();
  check(s3row.data.status === "imported" && s3row.data.current_revision_id === s3.rev && f3.data.status === "needs_manual", "can't read: song hidden, AI draft kept, file needs_manual");
  expectNone(await anon.from("songs").select("id").eq("id", s3.id), "song 3 hidden from signed-out visitors");
  const manual = await rv.db.rpc("review_list", { p_filter: "needs_manual", p_order: "title", p_q: "Claim Check 3", p_limit: 5, p_offset: 0 });
  check(!manual.error && manual.data.songs.some((x) => x.id === s3.id), "song 3 is in the needs_manual filter");
  const main = await rv.db.rpc("review_list", { p_filter: "needs_review", p_order: "title", p_q: "Claim Check 3", p_limit: 5, p_offset: 0 });
  check(!main.error && !main.data.songs.some((x) => x.id === s3.id), "…and out of the main queue");
  const rp = await rv.db.rpc("review_publish", { p_song_id: s3.id, p_chart: FIXED.replace("Claim Check", "Claim Check 3"), p_verified: false, p_base_revision: s3.rev });
  check(!rp.error && rp.data === "unverified", "reviewer publishes the typed chart as unverified");
  const s3live = await anon.from("songs").select("unverified").eq("id", s3.id).maybeSingle();
  check(s3live.data?.unverified === true, "signed-out visitors see song 3, marked unverified");

  // ── duplicates ──
  const dl = await a.db.rpc("review_list", { p_filter: "duplicates", p_order: "title", p_q: "Claim Check Dup", p_limit: 5, p_offset: 0 });
  check(!dl.error && dl.data.songs.filter((x) => x.id === d1.id || x.id === d2.id).length === 2, "both copies are in the duplicates filter");
  const ds = await a.db.rpc("review_song", { p_song_id: d1.id });
  check(!ds.error && ds.data.duplicates.some((x) => x.id === d2.id), "review_song links the other copy");
  const md = await a.db.rpc("review_mark_duplicate", { p_song_id: d1.id });
  check(!md.error, "admin marks a duplicate");
  const d1row = await svc.from("songs").select("status").eq("id", d1.id).single();
  check(d1row.data.status === "archived", "the duplicate is hidden (archived, kept)");

  // ── progress ──
  const pr = await rv.db.rpc("review_progress");
  const people = pr.data?.people ?? [];
  check(
    !pr.error && pr.data.total > 0 && people.some((x) => x.name === "Check Admin A" && x.total >= 1 && x.today >= 1) && people.some((x) => x.name === "Check Reviewer" && x.total >= 2),
    "progress counts each person's publishes and can't-reads",
  );

  // ── blocked reviewers lose access ──
  await svc.from("profiles").update({ blocked: true }).eq("id", rv.id);
  expectErr(await rv.db.rpc("review_list", { p_filter: "needs_review", p_order: "title", p_q: "", p_limit: 1, p_offset: 0 }), "a blocked reviewer is locked out");
} finally {
  if (songs.length) await svc.from("songs").delete().in("id", songs);
  if (files.length) await svc.from("import_files").delete().in("id", files);
  for (const u of users) await svc.auth.admin.deleteUser(u.id);
  console.log(`cleaned up ${users.length} test user(s), ${songs.length} song(s), ${files.length} file(s)`);
}
if (failed) {
  console.log(`${failed} check(s) FAILED`);
  process.exit(1);
}
console.log("all claim checks passed");
