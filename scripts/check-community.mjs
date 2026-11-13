// Blocker check for community edits, run against the real database (RLS + functions).
// Creates a throwaway published song and six throwaway users, exercises proposals, votes,
// stale protection, revert, personal versions, limits and blocking, then deletes them all.
// Run: npm run check:community   (needs SUPABASE_SERVICE_ROLE_KEY)
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
const blocked = (r, m) => (r.error ? pass(`${m} (${r.error.message})`) : fail(`${m}: NOT blocked`));
const truthy = (v, m) => (v ? pass(m) : fail(m));
const noRows = (r) => (r.error ? r : r.data?.length ? r : { error: { message: "0 rows changed" } });

const stamp = Date.now();
async function makeUser(tag) {
  const email = `community-check-${tag}-${stamp}@example.com`;
  const created = await svc.auth.admin.createUser({ email, email_confirm: true });
  if (created.error) throw created.error;
  const link = await svc.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  const db = createClient(url, anonKey, opts);
  const v = await db.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
  if (v.error) throw v.error;
  await svc.from("profiles").update({ display_name: `Check ${tag}` }).eq("id", created.data.user.id);
  return { id: created.data.user.id, db };
}

const chart = (body) => `{title: Community Check ${stamp}}\n{key: G}\n\n${body}\n`;
const BASE = chart("[V] 1 4 5 1\n[C] 1 5 6- 4");
const T1 = chart("[V] 1 4 5 1\n[C] 1 5 6- 5");
const T2 = chart("[V] 1 4 2- 1\n[C] 1 5 6- 4");

const users = [];
let songId = null;
let restoreVotes = null;
try {
  // ── fixtures ──
  const song = await svc
    .from("songs")
    .insert({ slug: `community-check-${stamp}`, title: `Community Check ${stamp}`, status: "published" })
    .select("id")
    .single();
  if (song.error) throw song.error;
  songId = song.data.id;
  const r0 = await svc.from("revisions").insert({ song_id: songId, chart_text: BASE, source: "human", note: "base" }).select("id").single();
  if (r0.error) throw r0.error;
  await svc.from("songs").update({ current_revision_id: r0.data.id }).eq("id", songId);
  const R0 = r0.data.id;

  const [A, V1, V2, V3, ADM, O] = await Promise.all(["author", "v1", "v2", "v3", "admin", "other"].map(makeUser));
  users.push(A, V1, V2, V3, ADM, O);
  await svc.from("profiles").update({ role: "admin" }).eq("id", ADM.id);
  const current = async () => (await svc.from("songs").select("current_revision_id").eq("id", songId).single()).data.current_revision_id;
  const propose = (u, text, note = "check change", base = undefined) =>
    u.db
      .from("proposals")
      .insert({ song_id: songId, chart_text: text, note, author_id: u.id, ...(base === undefined ? {} : { base_revision_id: base }) })
      .select("id")
      .single();
  const vote = (u, id, value) => u.db.from("votes").insert({ proposal_id: id, voter_id: u.id, value });
  const status = async (id) => (await svc.from("proposals").select("status, resulting_revision_id").eq("id", id).single()).data;

  // ── proposing ──
  const p1 = await propose(A, T1, "chorus ends on the 5");
  ok(p1, "author opens a suggestion");
  const P1 = p1.data?.id;
  blocked(await propose(A, T2, ""), "suggestion without a note");
  blocked(await propose(A, chart(`[V] "and then we all went down to town" 1 4`)), "suggestion with a long cue (lyrics guard)");
  blocked(await propose(A, BASE), "suggestion with no change");
  blocked(await propose(A, T2, "old base", "00000000-0000-0000-0000-000000000000"), "suggestion based on a revision that isn't live");

  // ── BLOCKER: can't self-approve ──
  blocked(await vote(A, P1, "approve"), "author votes on own suggestion");
  const pa = await propose(ADM, T2, "admin idea");
  ok(pa, "admin opens a suggestion");
  blocked(await ADM.db.rpc("admin_decide", { p_id: pa.data?.id, p_approve: true }), "admin 'approve now' on own suggestion");
  blocked(await vote(ADM, pa.data?.id, "approve"), "admin votes on own suggestion");
  ok(await ADM.db.rpc("withdraw_proposal", { p_id: pa.data?.id }), "admin withdraws own suggestion");
  blocked(await V1.db.rpc("decide_proposal", { p_id: P1, p_approve: true, p_by: V1.id }), "contributor calls decide_proposal directly");
  blocked(await V1.db.rpc("admin_decide", { p_id: P1, p_approve: true }), "contributor calls admin_decide");

  // ── BLOCKER: can't double-vote ──
  ok(await vote(V1, P1, "approve"), "voter 1 approves");
  blocked(await vote(V1, P1, "approve"), "voter 1 votes twice");
  blocked(await vote(V1, P1, "reject"), "voter 1 changes vote by inserting again");
  blocked(noRows(await V1.db.from("votes").update({ value: "reject" }).eq("proposal_id", P1).eq("voter_id", V1.id).select()), "voter 1 updates their vote");
  blocked(await V2.db.from("votes").insert({ proposal_id: P1, voter_id: V1.id, value: "approve" }), "voter 2 votes as voter 1");

  // P2 is opened on the same base before P1 merges.
  const p2 = await propose(V2, T2, "verse goes to the 2-");
  ok(p2, "second suggestion on the same chart");
  const P2 = p2.data?.id;

  // ── 3 approvals merge ──
  ok(await vote(V2, P1, "approve"), "voter 2 approves");
  truthy((await status(P1)).status === "open", "still open after 2 approvals");
  ok(await vote(V3, P1, "approve"), "voter 3 approves");
  const s1 = await status(P1);
  truthy(s1.status === "approved", "merged after 3 approvals");
  const R1 = await current();
  truthy(R1 === s1.resulting_revision_id && R1 !== R0, "song's live revision is the merged one");
  const rev1 = (await svc.from("revisions").select("chart_text, source, author_id").eq("id", R1).single()).data;
  truthy(rev1.chart_text === T1 && rev1.source === "community" && rev1.author_id === A.id, "new revision: suggested text, source community, author credited");
  const nA = (await A.db.from("notifications").select("kind").eq("proposal_id", P1)).data ?? [];
  truthy(nA.some((n) => n.kind === "merged"), "author notified: merged");
  blocked(await vote(O, P1, "approve"), "vote on a merged suggestion");

  // ── BLOCKER: a stale suggestion can't overwrite a newer revision ──
  const p2row = (await anon.from("proposals").select("out_of_date").eq("id", P2).single()).data;
  truthy(p2row?.out_of_date === true, "second suggestion is marked out of date");
  blocked(await vote(V1, P2, "approve"), "vote on an out-of-date suggestion");
  blocked(await ADM.db.rpc("admin_decide", { p_id: P2, p_approve: true }), "admin 'approve now' on an out-of-date suggestion");
  truthy((await current()) === R1, "live revision unchanged (newer chart kept)");
  const nV2 = (await V2.db.from("notifications").select("kind").eq("proposal_id", P2)).data ?? [];
  truthy(nV2.some((n) => n.kind === "out_of_date"), "author of the stale suggestion notified");
  blocked(await V1.db.rpc("update_proposal", { p_id: P2, p_chart: T2, p_note: "hijack" }), "non-author updates someone's suggestion");
  ok(
    await V2.db.rpc("update_proposal", { p_id: P2, p_chart: chart("[V] 1 4 2- 1\n[C] 1 5 6- 5"), p_note: "rebased onto the new chorus" }),
    "author updates the stale suggestion",
  );
  const p2b = (await svc.from("proposals").select("base_revision_id").eq("id", P2).single()).data;
  truthy(p2b.base_revision_id === R1, "updated suggestion is based on the live revision");
  ok(await vote(V1, P2, "approve"), "voting works again after the update");

  // ── 3 rejections close ──
  const p3 = await propose(A, chart("[V] 1 1 1 1\n[C] 1 5 6- 5"), "all ones");
  const P3 = p3.data?.id;
  for (const u of [V1, V2, V3]) await vote(u, P3, "reject");
  truthy((await status(P3)).status === "rejected", "closed after 3 rejections");
  truthy((await current()) === R1, "rejection doesn't change the chart");
  const nA3 = (await A.db.from("notifications").select("kind").eq("proposal_id", P3)).data ?? [];
  truthy(nA3.some((n) => n.kind === "closed"), "author notified: closed");

  // ── BLOCKER: revert works and keeps history ──
  blocked(await V1.db.rpc("revert_song", { p_song_id: songId, p_revision_id: R0 }), "contributor reverts");
  const rv = await ADM.db.rpc("revert_song", { p_song_id: songId, p_revision_id: R0 });
  ok(rv, "admin reverts to the first revision");
  const R2 = await current();
  const hist = (await anon.from("revisions").select("id, chart_text").eq("song_id", songId)).data ?? [];
  truthy(R2 === rv.data && R2 !== R0 && R2 !== R1, "revert made a new revision");
  truthy(hist.length === 3 && hist.some((r) => r.id === R0) && hist.some((r) => r.id === R1), "history kept: all 3 revisions readable by anyone");
  truthy(hist.find((r) => r.id === R2)?.chart_text === BASE, "live chart is the old text again");
  blocked(await ADM.db.rpc("revert_song", { p_song_id: songId, p_revision_id: R2 }), "revert to the version that's already live");
  blocked(noRows(await ADM.db.from("revisions").delete().eq("id", R0).select()), "revisions can't be deleted");

  // ── personal versions: owner only ──
  ok(await O.db.from("personal_chart_versions").insert({ user_id: O.id, song_id: songId, chart_text: T2, based_on_revision_id: R2 }), "player saves a personal version");
  blocked(await O.db.from("personal_chart_versions").insert({ user_id: O.id, song_id: songId, chart_text: T1 }), "second personal version for the same song");
  const peek = await V1.db.from("personal_chart_versions").select("*").eq("user_id", O.id);
  !peek.error && peek.data.length === 0 ? pass("another player can't read it") : fail("another player read a personal version");
  const peekAnon = await anon.from("personal_chart_versions").select("*");
  peekAnon.error || peekAnon.data.length === 0 ? pass("signed-out can't read personal versions") : fail("anon read personal versions");
  blocked(await V1.db.from("personal_chart_versions").insert({ user_id: O.id, song_id: songId, chart_text: T1 }), "writing someone else's personal version");
  blocked(noRows(await V1.db.from("personal_chart_versions").update({ chart_text: T1 }).eq("user_id", O.id).select()), "changing someone else's personal version");
  blocked(
    await O.db.from("personal_chart_versions").update({ chart_text: chart(`[V] "this is a long lyric line here ok" 1`) }).eq("user_id", O.id).eq("song_id", songId),
    "long cue in a personal version",
  );
  const myOpen = (await O.db.from("proposals").select("id").eq("author_id", O.id).eq("status", "open")).data ?? [];
  truthy(myOpen.length === 0, "personal version doesn't create a suggestion");

  // ── limits ──
  const mine = [];
  for (let i = 0; i < 5; i++) {
    const r = await propose(O, chart(`[V] 1 4 5 ${i + 2}\n[C] 1 5 6- 4`), `try ${i}`);
    if (!r.error) mine.push(r.data.id);
  }
  truthy(mine.length === 5, "5 open suggestions allowed");
  blocked(await propose(O, chart("[V] 1 4 5 7\n[C] 1 5 6- 4"), "sixth"), "6th open suggestion");
  const vph = (await svc.from("settings").select("value").eq("key", "votes_per_hour").single()).data.value;
  restoreVotes = vph;
  await svc.from("settings").update({ value: 2 }).eq("key", "votes_per_hour");
  // V3 already cast 2 votes this hour (P1, P3), so a limit of 2 is reached.
  blocked(await vote(V3, mine[0], "approve"), "vote rate limit");
  await svc.from("settings").update({ value: vph }).eq("key", "votes_per_hour");
  restoreVotes = null;
  ok(await vote(V3, mine[0], "approve"), "voting works again under the normal limit");

  // ── settings ──
  blocked(await V1.db.rpc("set_setting", { p_key: "approvals_needed", p_value: 1 }), "contributor changes the approval threshold");
  blocked(noRows(await V1.db.from("settings").update({ value: 1 }).eq("key", "approvals_needed").select()), "contributor updates the settings table");
  const need = (await svc.from("settings").select("value").eq("key", "approvals_needed").single()).data.value;
  ok(await ADM.db.rpc("set_setting", { p_key: "approvals_needed", p_value: need }), "admin can change a setting");

  // ── reports ──
  ok(await V1.db.from("reports").insert({ reporter_id: V1.id, proposal_id: P2, reason: "spam" }), "player reports a suggestion");
  blocked(await V1.db.from("reports").insert({ reporter_id: V1.id, proposal_id: P2, reason: "other" }), "same report twice");
  const rp = await V2.db.from("reports").select("id").eq("reporter_id", V1.id);
  !rp.error && rp.data.length === 0 ? pass("players can't read others' reports") : fail("player read another's report");
  const ra = await ADM.db.from("reports").select("id").eq("reporter_id", V1.id);
  truthy(ra.data?.length === 1, "admin reads reports");

  // ── blocking ──
  blocked(await V1.db.rpc("set_blocked", { p_user: O.id, p_blocked: true }), "contributor blocks someone");
  blocked(await O.db.from("profiles").update({ blocked: true }).eq("id", O.id), "player edits own blocked flag");
  ok(await ADM.db.rpc("set_blocked", { p_user: O.id, p_blocked: true }), "admin blocks a player");
  const left = (await svc.from("proposals").select("id").eq("author_id", O.id).eq("status", "open")).data ?? [];
  truthy(left.length === 0, "blocked player's open suggestions withdrawn");
  blocked(await propose(O, chart("[V] 1 4 5 6\n[C] 1 5 6- 4"), "blocked"), "blocked player suggests");
  blocked(await vote(O, P2, "approve"), "blocked player votes");
  blocked(await O.db.from("reports").insert({ reporter_id: O.id, proposal_id: P2, reason: "spam" }), "blocked player reports");
  const keep = await O.db.from("personal_chart_versions").select("song_id");
  truthy(keep.data?.length === 1, "blocked player keeps their personal version");
  blocked(await ADM.db.rpc("set_blocked", { p_user: ADM.id, p_blocked: true }), "admin can't be blocked");

  // ── anon ──
  const pubP = await anon.from("proposals").select("id").eq("id", P2);
  truthy(pubP.data?.length === 1, "signed-out can read suggestions");
  blocked(await anon.from("votes").insert({ proposal_id: P2, voter_id: V1.id, value: "approve" }), "signed-out votes");
  const notes = await anon.from("notifications").select("*");
  notes.error || notes.data.length === 0 ? pass("signed-out can't read notifications") : fail("anon read notifications");
  const others = await V1.db.from("notifications").select("id").eq("user_id", A.id);
  !others.error && others.data.length === 0 ? pass("players can't read others' notifications") : fail("read others' notifications");
} catch (e) {
  fail(`crashed: ${e.message ?? e}`);
} finally {
  if (restoreVotes !== null) await svc.from("settings").update({ value: restoreVotes }).eq("key", "votes_per_hour");
  if (songId) await svc.from("songs").delete().eq("id", songId);
  for (const u of users) await svc.auth.admin.deleteUser(u.id);
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll community checks passed");
process.exit(failed ? 1 : 0);
