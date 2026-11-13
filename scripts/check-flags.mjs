// Blocker check for personal flags ("Flag for me"). Creates throwaway users (two players and an
// admin) and fake songs, then checks:
//   * only the owner can read, change or delete a flag (not other players, not admins, not anon)
//   * only the note can change; the spot stays as flagged; notes are capped at 60 characters
//   * moving signed-out flags in keeps the account's flag on the same spot
//   * a revision from another song is refused; unpublished songs can't be flagged; 200 per song max
//   * flags never create proposals or votes
// Deletes it all. Run: npm run check:flags   (needs SUPABASE_SERVICE_ROLE_KEY)
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
async function makeUser(tag) {
  const email = `flags-check-${tag}-${stamp}@example.com`;
  const created = await svc.auth.admin.createUser({ email, email_confirm: true });
  if (created.error) throw created.error;
  const link = await svc.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  const db = createClient(url, anonKey, opts);
  const v = await db.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
  if (v.error) throw v.error;
  return { id: created.data.user.id, db };
}

const CHART = `{title: Flags Check ${stamp}}\n{key: G}\n\n[V] 1 4 5 1\n`;
const users = [];
const songs = [];
async function makeSong(n, status) {
  const s = await svc.from("songs").insert({ slug: `flags-check-${stamp}-${n}`, title: `Flags Check ${n}`, status }).select("id").single();
  if (s.error) throw s.error;
  songs.push(s.data.id);
  const r = await svc.from("revisions").insert({ song_id: s.data.id, chart_text: CHART, source: "human", note: "base" }).select("id").single();
  if (r.error) throw r.error;
  await svc.from("songs").update({ current_revision_id: r.data.id }).eq("id", s.data.id);
  return { id: s.data.id, rev: r.data.id };
}
const spot = (song, bar, extra = {}) => ({
  song_id: song.id,
  revision_id: song.rev,
  section_index: 0,
  section_label: "V",
  bar_index: bar,
  beat_index: 0,
  item_text: "4",
  ...extra,
});

try {
  const song = await makeSong(1, "published");
  const other = await makeSong(2, "published");
  const hidden = await makeSong(3, "needs_review");
  const [A, B, ADM] = await Promise.all(["a", "b", "admin"].map(makeUser));
  users.push(A, B, ADM);
  await svc.from("profiles").update({ role: "admin" }).eq("id", ADM.id);
  const proposals = async () => (await svc.from("proposals").select("id", { count: "exact", head: true }).eq("song_id", song.id)).count ?? 0;
  const before = await proposals();

  // ── owner writes ──
  const ins = await A.db.from("personal_flags").insert(spot(song, 1, { note: "  watch the push  " })).select().single();
  check(!ins.error && ins.data.user_id === A.id && ins.data.note === "watch the push", "owner flags a spot (note trimmed, owner set)");
  const flagId = ins.data?.id;
  expectErr(await A.db.from("personal_flags").insert(spot(song, 1)), "same spot twice is refused");
  expectErr(await A.db.from("personal_flags").insert(spot(song, 2, { note: "x".repeat(61) })), "note over 60 characters is refused");
  expectErr(await A.db.from("personal_flags").insert(spot(song, 2, { revision_id: other.rev })), "revision from another song is refused");
  expectErr(await A.db.from("personal_flags").insert(spot(hidden, 0)), "unpublished song can't be flagged");
  expectErr(await A.db.from("personal_flags").insert({ ...spot(song, 3), user_id: B.id }), "can't flag as someone else");
  check(!(await A.db.from("personal_flags").insert(spot(song, 4, { revision_id: null }))).error, "flag on own version (no revision) is allowed");

  // ── only the owner can see or touch it ──
  expectErr(await anon.from("personal_flags").select("id"), "signed-out visitors can't read flags");
  expectErr(await anon.from("personal_flags").insert(spot(song, 5)), "signed-out visitors can't write flags");
  expectNone(await B.db.from("personal_flags").select("id").eq("song_id", song.id), "another player can't read the flags");
  expectNone(await ADM.db.from("personal_flags").select("id").eq("song_id", song.id), "an admin can't read the flags");
  await B.db.from("personal_flags").update({ note: "hacked" }).eq("id", flagId);
  await ADM.db.from("personal_flags").update({ note: "hacked" }).eq("id", flagId);
  await B.db.from("personal_flags").delete().eq("id", flagId);
  await ADM.db.from("personal_flags").delete().eq("id", flagId);
  const still = await svc.from("personal_flags").select("note").eq("id", flagId).maybeSingle();
  check(still.data?.note === "watch the push", "others can't change or delete the flag");
  const mine = await A.db.from("personal_flags").select("id").eq("song_id", song.id);
  check(mine.data?.length === 2, "owner reads own flags");

  // ── only the note changes ──
  const upd = await A.db.from("personal_flags").update({ note: "count 4", bar_index: 3, item_text: "9", song_id: other.id }).eq("id", flagId).select().single();
  check(
    !upd.error && upd.data.note === "count 4" && upd.data.bar_index === 1 && upd.data.item_text === "4" && upd.data.song_id === song.id,
    "owner edits the note; the spot stays as flagged",
  );

  // ── moving signed-out flags in: the account's flag wins ──
  const mv = await A.db.from("personal_flags").upsert([spot(song, 1, { note: "from the phone" }), spot(song, 6, { note: "new one" })], {
    onConflict: "user_id,song_id,section_index,bar_index,beat_index",
    ignoreDuplicates: true,
  });
  const after = await A.db.from("personal_flags").select("bar_index, note").eq("song_id", song.id);
  check(
    !mv.error && after.data?.find((r) => r.bar_index === 1)?.note === "count 4" && after.data?.some((r) => r.bar_index === 6),
    `moving device flags in adds new spots and keeps the account's flag on the same spot${mv.error ? ` (${mv.error.message})` : ""}`,
  );

  // ── 200 per song ──
  const bulk = await A.db.from("personal_flags").insert(Array.from({ length: 199 }, (_, i) => spot(other, i)));
  check(!bulk.error, "199 flags on one song are fine");
  check(!(await A.db.from("personal_flags").insert(spot(other, 500))).error, "the 200th flag is fine");
  expectErr(await A.db.from("personal_flags").insert(spot(other, 501)), "the 201st flag on one song is refused");

  // ── never votes or proposals ──
  check((await proposals()) === before, "flags create no proposals");
  const votes = await svc.from("votes").select("*", { count: "exact", head: true }).in("voter_id", [A.id, B.id, ADM.id]);
  check(!votes.error && (votes.count ?? 0) === 0, `flags create no votes${votes.error ? ` (${votes.error.message})` : ""}`);

  // ── owner deletes ──
  const del = await A.db.from("personal_flags").delete().eq("song_id", song.id).select("id");
  check(!del.error && del.data.length === 3, "owner clears all flags on a song");
} catch (e) {
  fail(`crashed: ${e.message ?? e}`);
} finally {
  for (const id of songs) await svc.from("songs").delete().eq("id", id);
  for (const u of users) await svc.auth.admin.deleteUser(u.id);
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll flag checks passed");
process.exit(failed ? 1 : 0);
