// Blocker check for setlists (database: RLS + setlist_* functions). Creates two throwaway users,
// checks owner-only access, share links signed out, limits, then deletes both users.
// Run: npm run check:setlists   (needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const svc = createClient(url, serviceKey, opts);
const anon = createClient(url, anonKey, opts);

let failed = 0;
const pass = (m) => console.log("PASS", m);
const fail = (m) => { failed++; console.log("FAIL", m); };
const check = (ok, m, detail) => (ok ? pass(m) : fail(detail ? `${m}: ${detail}` : m));
const blocked = (r, m) => check(!!r.error || r.data == null || (Array.isArray(r.data) && r.data.length === 0), m, JSON.stringify(r.data));

async function makeUser(tag) {
  const email = `setlists-check-${tag}-${Date.now()}@example.com`;
  const created = await svc.auth.admin.createUser({ email, email_confirm: true });
  if (created.error) throw created.error;
  const link = await svc.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  const db = createClient(url, anonKey, opts);
  const v = await db.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
  if (v.error) throw v.error;
  return { id: created.data.user.id, db };
}

const users = [];
try {
  const a = await makeUser("owner");
  users.push(a);
  const b = await makeUser("other");
  users.push(b);

  const songs = await anon.from("songs").select("id, slug, title").eq("status", "published").order("title").limit(3);
  if (songs.error || songs.data.length < 2) throw new Error("need 2+ published songs");
  const [s1, s2] = songs.data;

  // Owner: create, add, save with key + note, read back in one call.
  const made = await a.db.from("setlists").insert({ name: "Check set" }).select("id").single();
  check(!made.error, "owner creates a setlist", made.error?.message);
  const id = made.data.id;
  const add = await a.db.rpc("setlist_add", { p_id: id, p_slug: s1.slug });
  check(!add.error && add.data === 1, "owner adds a song by slug", add.error?.message);
  const save = await a.db.rpc("setlist_save", {
    p_id: id, p_name: "Friday", p_date: "2026-11-20",
    p_items: [{ slug: s2.slug, key: "D", note: "start on the chorus" }, { slug: s1.slug }, { slug: s2.slug, note: "reprise" }, { slug: "no-such-song" }],
  });
  check(!save.error, "owner saves name, date, order, key and note", save.error?.message);
  const bundle = await a.db.rpc("setlist_bundle", { p_id: id });
  const it = bundle.data?.items ?? [];
  check(
    bundle.data?.name === "Friday" && bundle.data.gig_date === "2026-11-20" && it.length === 3 &&
      it[0].song?.slug === s2.slug && it[0].key_override === "D" && it[0].note === "start on the chorus" &&
      it[1].song?.slug === s1.slug && it[2].note === "reprise" && it.every((x) => typeof x.song?.chart_text === "string"),
    "one call returns the setlist in order with keys, notes and every chart (unknown slug skipped)",
    JSON.stringify(bundle.error ?? it.map((x) => [x.song?.slug, x.key_override, x.note])),
  );

  // Limits.
  const longNote = await a.db.rpc("setlist_save", { p_id: id, p_name: "x", p_date: null, p_items: [{ slug: s1.slug, note: "x".repeat(61) }] });
  check(!!longNote.error, "note over 60 characters rejected");
  const tooMany = await a.db.rpc("setlist_save", { p_id: id, p_name: "x", p_date: null, p_items: Array.from({ length: 101 }, () => ({ slug: s1.slug })) });
  check(!!tooMany.error, "more than 100 songs rejected");
  const after = await a.db.rpc("setlist_bundle", { p_id: id });
  check(after.data?.items?.length === 3, "a rejected save leaves the setlist unchanged", String(after.data?.items?.length));

  // Private by default: another user and anon see nothing.
  blocked(await b.db.from("setlists").select("id").eq("id", id), "other user can't read the setlist");
  blocked(await b.db.from("setlist_items").select("id").eq("setlist_id", id), "other user can't read its songs");
  blocked(await b.db.rpc("setlist_bundle", { p_id: id }), "other user can't load it by id");
  blocked(await anon.from("setlists").select("id"), "anon can't list setlists");
  blocked(await anon.from("setlist_items").select("id"), "anon can't list setlist songs");
  blocked(await anon.rpc("setlist_bundle", { p_id: id }), "anon can't load it by id");
  check(!!(await b.db.rpc("setlist_add", { p_id: id, p_slug: s1.slug })).error, "other user can't add songs");
  check(!!(await b.db.rpc("setlist_save", { p_id: id, p_name: "hacked", p_date: null, p_items: [] })).error, "other user can't save it");
  check(!!(await b.db.rpc("setlist_share", { p_id: id, p_on: true })).error, "other user can't share it");
  blocked(await b.db.from("setlists").delete().eq("id", id).select(), "other user can't delete it");
  check(!!(await anon.rpc("setlist_share", { p_id: id, p_on: true })).error, "anon can't share it");
  blocked(await a.db.from("setlists").update({ share_code: "owner-chosen-code-123" }).eq("id", id).select(), "owner can't set share_code directly");
  blocked(await a.db.from("setlists").update({ owner_id: b.id }).eq("id", id).select(), "owner can't hand the setlist to someone else directly");

  // Share link: works signed out, view-only, nothing private leaks.
  const sh = await a.db.rpc("setlist_share", { p_id: id, p_on: true });
  check(!sh.error && /^[A-Za-z0-9_-]{16,}$/.test(sh.data ?? ""), "owner makes a share code", sh.error?.message ?? sh.data);
  const code = sh.data;
  const pub = await anon.rpc("setlist_bundle", { p_code: code });
  check(
    pub.data?.name === "Friday" && pub.data.items.length === 3 && pub.data.items[0].key_override === "D" &&
      typeof pub.data.items[0].song?.chart_text === "string" && pub.data.id === null && pub.data.share_code === null && pub.data.mine === false,
    "shared link loads signed out (keys, notes, charts) without the id or owner",
    JSON.stringify(pub.error ?? pub.data),
  );
  blocked(await anon.rpc("setlist_bundle", { p_code: code.slice(0, -1) + (code.endsWith("A") ? "B" : "A") }), "a wrong code loads nothing");
  blocked(await anon.rpc("setlist_bundle", { p_id: id, p_code: code }), "id + code together doesn't bypass the owner check");
  blocked(await anon.from("setlists").select("id").not("share_code", "is", null), "shared setlists still can't be listed");
  await a.db.rpc("setlist_save", { p_id: id, p_name: "Friday late", p_date: "2026-11-20", p_items: [{ slug: s1.slug }] });
  const live = await anon.rpc("setlist_bundle", { p_code: code });
  check(live.data?.name === "Friday late" && live.data.items.length === 1, "band sees the owner's edits on reload");
  const offr = await a.db.rpc("setlist_share", { p_id: id, p_on: false });
  check(!offr.error && offr.data === null, "owner stops sharing");
  blocked(await anon.rpc("setlist_bundle", { p_code: code }), "old link stops working");
  const again = await a.db.rpc("setlist_share", { p_id: id, p_on: true });
  check(!!again.data && again.data !== code, "sharing again makes a new code");

  // Device lists / snapshots: songs with charts by slug, signed out.
  const sb = await anon.rpc("songs_bundle", { p_slugs: [s1.slug, s2.slug, "no-such-song"] });
  check(!sb.error && sb.data.length === 2 && sb.data.every((x) => typeof x.chart_text === "string"), "songs_bundle loads charts signed out", sb.error?.message);

  // Delete.
  const del = await a.db.from("setlists").delete().eq("id", id).select();
  check(!del.error && del.data.length === 1, "owner deletes the setlist");
  blocked(await a.db.rpc("setlist_bundle", { p_id: id }), "deleted setlist is gone");
} finally {
  for (const u of users) await svc.auth.admin.deleteUser(u.id);
}

console.log(failed ? `\n${failed} setlist check(s) FAILED` : "\nAll setlist checks passed");
process.exit(failed ? 1 : 0);
