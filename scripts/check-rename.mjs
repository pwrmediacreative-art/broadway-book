// Blocker check for renaming songs, run against the real database (RLS + functions).
// Creates a throwaway published song, a throwaway private chart and six throwaway users,
// exercises admin renames, owner renames, name suggestions + votes, redirects, the rename
// log and "the new name sticks" on publish, then deletes them all.
// Run: npm run check:rename   (needs SUPABASE_SERVICE_ROLE_KEY)
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

const stamp = Date.now();
async function makeUser(tag) {
  const email = `rename-check-${tag}-${stamp}@example.com`;
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

const users = [];
const songIds = [];
try {
  // ── fixtures ──
  const slug0 = `rename-check-${stamp}`;
  const song = await svc.from("songs").insert({ slug: slug0, title: `Rename Check ${stamp}`, artist: "Old Band", status: "published" }).select("id").single();
  if (song.error) throw song.error;
  const S = song.data.id;
  songIds.push(S);
  const CH = `{title: Rename Check ${stamp}}\n{artist: Old Band}\n{key: G}\n\n[V] 1 4 5 1\n`;
  const r0 = await svc.from("revisions").insert({ song_id: S, chart_text: CH, source: "human", note: "base" }).select("id").single();
  if (r0.error) throw r0.error;
  await svc.from("songs").update({ current_revision_id: r0.data.id }).eq("id", S);

  const [A, V1, V2, V3, ADM, OWN] = await Promise.all(["author", "v1", "v2", "v3", "admin", "owner"].map(makeUser));
  users.push(A, V1, V2, V3, ADM, OWN);
  await svc.from("profiles").update({ role: "admin" }).eq("id", ADM.id);
  const name = async (id = S) => (await svc.from("songs").select("slug, title, artist").eq("id", id).single()).data;

  // ── who may rename at once ──
  blocked(await anon.rpc("rename_song", { p_song: S, p_title: "Hacked", p_artist: "" }), "signed-out can't rename");
  blocked(await A.db.rpc("rename_song", { p_song: S, p_title: "Hacked", p_artist: "" }), "player can't rename a public song directly");
  blocked(await A.db.from("songs").update({ title: "Hacked" }).eq("id", S).select("id").then((r) => (r.error || r.data?.length ? r : { error: { message: "0 rows" } })), "player can't update songs.title");
  blocked(await A.db.from("song_renames").insert({ song_id: S, old_title: "a", new_title: "b", old_slug: "a", new_slug: "b", via: "admin" }), "player can't write the rename log");
  const t1 = `Rename Check Two ${stamp}`;
  const r1 = await ADM.db.rpc("rename_song", { p_song: S, p_title: `  ${t1} `, p_artist: "New  Band" });
  ok(r1, "admin renames a public song");
  const n1 = await name();
  truthy(n1.title === t1 && n1.artist === "New Band", "name saved trimmed");
  truthy(n1.slug !== slug0 && n1.slug === r1.data, `new slug (${n1.slug})`);
  const red = await anon.rpc("resolve_slug", { p_slug: slug0 });
  truthy(red.data === n1.slug, "old slug redirects to the new one");
  const bundle = await anon.rpc("songs_bundle", { p_slugs: [slug0] });
  truthy(bundle.data?.[0]?.asked === slug0 && bundle.data?.[0]?.slug === n1.slug, "device setlists find the song by its old slug");
  const log = await anon.from("song_renames").select("old_title, new_title, via, by_id").eq("song_id", S);
  truthy(log.data?.length === 1 && log.data[0].via === "admin" && log.data[0].by_id === ADM.id, "rename logged (who, how), readable by anyone");
  blocked(await ADM.db.rpc("rename_song", { p_song: S, p_title: t1, p_artist: "New Band" }), "renaming to the same name");
  blocked(await ADM.db.rpc("rename_song", { p_song: S, p_title: "   ", p_artist: "x" }), "empty title");

  // ── the new name sticks when a chart is published ──
  const pr = await svc.rpc("publish_chart", { p_song_id: S, p_chart: CH.replace("[V] 1 4 5 1", "[V] 1 4 5 5"), p_author: null, p_source: "human", p_note: "check" });
  ok(pr, "publish a chart that still says the old name");
  const n2 = await name();
  truthy(n2.title === t1 && n2.artist === "New Band", "new name kept after publish");

  // ── suggestions + votes ──
  const t2 = `Rename Check Three ${stamp}`;
  const p = await A.db.rpc("propose_rename", { p_song: S, p_title: t2, p_artist: "New Band", p_note: "typo" });
  ok(p, "player suggests a new name");
  const P = p.data;
  blocked(await A.db.rpc("propose_rename", { p_song: S, p_title: t2 + "x", p_artist: "", p_note: null }), "second open suggestion for the same song");
  blocked(await A.db.rpc("vote_rename", { p_id: P, p_approve: true }), "author can't vote on own suggestion");
  blocked(await anon.rpc("vote_rename", { p_id: P, p_approve: true }), "signed-out can't vote");
  blocked(await V1.db.from("rename_votes").insert({ proposal_id: P, voter_id: V1.id, value: "approve" }), "votes only through the function");
  ok(await V1.db.rpc("vote_rename", { p_id: P, p_approve: true }), "vote 1");
  ok(await V2.db.rpc("vote_rename", { p_id: P, p_approve: true }), "vote 2");
  truthy((await name()).title === t1, "not live after 2 approvals");
  const v3 = await V3.db.rpc("vote_rename", { p_id: P, p_approve: true });
  truthy(v3.data === "approved", "3rd approval publishes it");
  const n3 = await name();
  truthy(n3.title === t2, "suggested name is live");
  truthy((await anon.rpc("resolve_slug", { p_slug: slug0 })).data === n3.slug, "oldest slug follows to the newest");
  truthy((await anon.rpc("resolve_slug", { p_slug: n1.slug })).data === n3.slug, "middle slug follows too");
  const log2 = await anon.from("song_renames").select("via, proposal_id, by_id").eq("song_id", S).eq("via", "community");
  truthy(log2.data?.length === 1 && log2.data[0].proposal_id === P && log2.data[0].by_id === A.id, "community rename logged with its suggestion");

  // ── rejections + admin decide ──
  const q = await A.db.rpc("propose_rename", { p_song: S, p_title: "Nope " + stamp, p_artist: "", p_note: null });
  for (const u of [V1, V2, V3]) await u.db.rpc("vote_rename", { p_id: q.data, p_approve: false });
  const qs = await svc.from("rename_proposals").select("status").eq("id", q.data).single();
  truthy(qs.data?.status === "rejected", "3 rejections close a suggestion");
  const w = await A.db.rpc("propose_rename", { p_song: S, p_title: "Admin Pick " + stamp, p_artist: "", p_note: null });
  blocked(await V1.db.rpc("admin_decide_rename", { p_id: w.data, p_approve: true }), "player can't decide instantly");
  ok(await ADM.db.rpc("admin_decide_rename", { p_id: w.data, p_approve: true }), "admin approves instantly");
  truthy((await name()).title === "Admin Pick " + stamp, "admin-approved name is live");

  // ── a new song taking an old slug wins it ──
  const taker = await svc.from("songs").insert({ slug: n1.slug, title: "Slug Taker", status: "published" }).select("id").single();
  if (taker.error) throw taker.error;
  songIds.push(taker.data.id);
  truthy((await anon.rpc("resolve_slug", { p_slug: n1.slug })).data === null, "a new song on an old slug drops that redirect");
  truthy((await anon.rpc("resolve_slug", { p_slug: slug0 })).data !== null, "other old slugs still redirect");

  // ── uploaded (private) charts ──
  const priv = await svc
    .from("songs")
    .insert({ slug: `rename-check-private-${stamp}`, title: "My Upload", status: "private", owner_id: OWN.id })
    .select("id")
    .single();
  if (priv.error) throw priv.error;
  songIds.push(priv.data.id);
  blocked(await A.db.rpc("rename_song", { p_song: priv.data.id, p_title: "Not Mine", p_artist: "" }), "player can't rename someone else's upload");
  blocked(await OWN.db.rpc("propose_rename", { p_song: priv.data.id, p_title: "x", p_artist: "", p_note: null }), "no suggestions on private charts");
  ok(await OWN.db.rpc("rename_song", { p_song: priv.data.id, p_title: "My Upload Renamed", p_artist: "Me" }), "owner renames own upload");
  const pn = await name(priv.data.id);
  truthy(pn.title === "My Upload Renamed" && pn.slug === `rename-check-private-${stamp}`, "upload renamed, slug kept");
  const plog = await anon.from("song_renames").select("id").eq("song_id", priv.data.id);
  truthy(!plog.error && plog.data.length === 0, "signed-out can't read a private chart's rename log");
} catch (e) {
  fail(`crashed: ${e.message ?? e}`);
} finally {
  for (const id of songIds) await svc.from("songs").delete().eq("id", id);
  await svc.from("song_slug_redirects").delete().like("old_slug", `rename-check-%${stamp}%`);
  for (const u of users) await svc.auth.admin.deleteUser(u.id);
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll rename checks passed");
process.exit(failed ? 1 : 0);
