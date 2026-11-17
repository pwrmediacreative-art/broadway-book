// Blocker check for "send a setlist copy" against the real database.
// Run: npm run check:invites   (needs SUPABASE_SERVICE_ROLE_KEY)
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
  const email = `invite-check-${tag}-${stamp}@example.com`;
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
  const [S, R, R2] = await Promise.all(["sender", "recipient", "other"].map(makeUser));
  users.push(S, R, R2);
  const pubs = (await svc.from("songs").select("id").eq("status", "published").limit(2)).data.map((x) => x.id);
  const priv = await svc.from("songs").insert({ slug: `invite-check-private-${stamp}`, title: `Secret Upload ${stamp}`, status: "private", owner_id: S.id }).select("id").single();
  if (priv.error) throw priv.error;
  songIds.push(priv.data.id);
  const rev = await svc.from("revisions").insert({ song_id: priv.data.id, chart_text: `{title: Secret}\n{key: G}\n\n[V] 1 4 5 1\n`, source: "human", note: "x" }).select("id").single();
  await svc.from("songs").update({ current_revision_id: rev.data.id }).eq("id", priv.data.id);

  const list = await S.db.from("setlists").insert({ name: `Gig ${stamp}`, gig_date: "2026-12-01" }).select("id").single();
  if (list.error) throw list.error;
  const L = list.data.id;
  const items = [
    { setlist_id: L, song_id: pubs[0], position: 1, key_override: "Bb", note: "start soft" },
    { setlist_id: L, song_id: priv.data.id, position: 2, key_override: null, note: "my upload" },
    { setlist_id: L, song_id: pubs[1], position: 3, key_override: null, note: null },
  ];
  ok(await S.db.from("setlist_items").insert(items), "sender builds a setlist with keys, notes and a private upload");
  truthy((await S.db.rpc("setlist_private_count", { p_setlist: L })).data === 1, "sender is told 1 song is private");
  truthy((await R.db.rpc("setlist_private_count", { p_setlist: L })).data === 0, "others can't probe the setlist");

  blocked(await R.db.rpc("setlist_invite_create", { p_setlist: L }), "only the owner can make a link");
  const c1 = await S.db.rpc("setlist_invite_create", { p_setlist: L });
  ok(c1, "owner makes an invite link");
  const code = c1.data;
  blocked(await anon.rpc("setlist_invite_open", { p_code: code }), "signed-out can't open (must sign in)");
  const prev = await R.db.rpc("setlist_invite_open", { p_code: code });
  truthy(prev.data?.state === "open" && prev.data?.count === 3 && prev.data?.sender === "Check sender", "recipient sees name, sender, song count");
  truthy(!JSON.stringify(prev.data).includes("Secret Upload"), "preview never shows song titles");
  const wait = await R.db.rpc("setlist_invites_waiting");
  truthy(wait.data?.length === 1 && wait.data[0].code === code, "it waits as a card for the recipient");

  const acc = await R.db.rpc("setlist_invite_accept", { p_code: code });
  ok(acc, "recipient accepts");
  const copy = acc.data;
  const b = (await R.db.rpc("setlist_bundle", { p_id: copy })).data;
  truthy(b?.copied_from === "Check sender" && !!b?.copied_at, "copy says who it came from and when");
  truthy(b?.items?.length === 3 && b.items[0].key_override === "Bb" && b.items[0].note === "start soft", "order, key override and note copied");
  truthy(b.items[1].song?.hidden === true && b.items[1].note === "my upload" && !JSON.stringify(b.items[1].song).includes("Secret"), "private song keeps its place, never shown");
  truthy((await R.db.rpc("setlist_invites_waiting")).data?.length === 0, "card goes away after accepting");

  // independence both ways
  await S.db.from("setlist_items").update({ note: "changed by sender" }).eq("setlist_id", L).eq("position", 1);
  await R.db.from("setlist_items").update({ key_override: "C" }).eq("setlist_id", copy).eq("position", 3);
  const b2 = (await R.db.rpc("setlist_bundle", { p_id: copy })).data;
  const src = (await S.db.rpc("setlist_bundle", { p_id: L })).data;
  truthy(b2.items[0].note === "start soft" && src.items[2].key_override === null, "edits on either side never reach the other");
  truthy((await S.db.rpc("setlist_bundle", { p_id: copy })).data === null, "sender can't open the recipient's copy");

  blocked(await R2.db.rpc("setlist_invite_accept", { p_code: code }), "a used link can't be accepted again");
  const sent = (await S.db.rpc("setlist_invites_for", { p_setlist: L })).data;
  truthy(sent?.[0]?.state === "used" && sent[0].accepted_name === "Check recipient", "sender sees who accepted");

  const c2 = (await S.db.rpc("setlist_invite_create", { p_setlist: L })).data;
  const id2 = (await S.db.rpc("setlist_invites_for", { p_setlist: L })).data.find((x) => x.code === c2).id;
  blocked(await R2.db.rpc("setlist_invite_revoke", { p_invite: id2 }), "only the sender can turn a link off");
  ok(await S.db.rpc("setlist_invite_revoke", { p_invite: id2 }), "sender turns a link off");
  blocked(await R2.db.rpc("setlist_invite_accept", { p_code: c2 }), "a turned-off link stops accepts");

  const c3 = (await S.db.rpc("setlist_invite_create", { p_setlist: L })).data;
  await svc.from("setlist_invites").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("code", c3);
  blocked(await R2.db.rpc("setlist_invite_accept", { p_code: c3 }), "an expired link stops accepts");

  const c4 = (await S.db.rpc("setlist_invite_create", { p_setlist: L })).data;
  await R2.db.rpc("setlist_invite_open", { p_code: c4 });
  ok(await R2.db.rpc("setlist_invite_decline", { p_code: c4 }), "recipient declines");
  truthy((await R2.db.rpc("setlist_invites_waiting")).data?.length === 0, "declined card goes away");
  blocked(await S.db.rpc("setlist_invite_accept", { p_code: c4 }), "sender can't accept their own link");
  const peek = await R.db.from("setlist_invites").select("code");
  truthy(peek.error || peek.data.length === 0, "invite codes aren't listable");
} catch (e) {
  fail(`crashed: ${e.message ?? e}`);
} finally {
  for (const u of users) await svc.auth.admin.deleteUser(u.id);
  for (const id of songIds) await svc.from("songs").delete().eq("id", id);
}
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll invite checks passed");
process.exit(failed ? 1 : 0);
