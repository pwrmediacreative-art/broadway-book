// Blocker check for user_prefs (Numbers/Chords following the player) against the real
// database: owner-only reads and writes, and saving twice (upsert) works.
// Run: npm run check:prefs   (needs SUPABASE_SERVICE_ROLE_KEY)
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
const truthy = (v, m) => (v ? pass(m) : fail(m));

const stamp = Date.now();
async function makeUser(tag) {
  const email = `prefs-check-${tag}-${stamp}@example.com`;
  const created = await svc.auth.admin.createUser({ email, email_confirm: true });
  if (created.error) throw created.error;
  const link = await svc.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  const db = createClient(url, anonKey, opts);
  const v = await db.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
  if (v.error) throw v.error;
  return { id: created.data.user.id, db };
}
const save = (u, id, v) => u.db.from("user_prefs").upsert({ user_id: id, chart_display: v, chart_display_at: new Date().toISOString(), updated_at: new Date().toISOString() });

const users = [];
try {
  const [A, B] = await Promise.all(["a", "b"].map(makeUser));
  users.push(A, B);
  ok(await save(A, A.id, "chords"), "first save (insert)");
  ok(await save(A, A.id, "numbers"), "second save (update through upsert)");
  const mine = await A.db.from("user_prefs").select("chart_display").eq("user_id", A.id).maybeSingle();
  truthy(mine.data?.chart_display === "numbers", "player reads back their choice");
  const peek = await B.db.from("user_prefs").select("chart_display").eq("user_id", A.id);
  truthy(!peek.error && peek.data.length === 0, "another player can't read it");
  const hijack = await save(B, A.id, "chords");
  const after = await A.db.from("user_prefs").select("chart_display").eq("user_id", A.id).maybeSingle();
  truthy(hijack.error && after.data?.chart_display === "numbers", "another player can't write it");
  const an = await anon.from("user_prefs").select("user_id").limit(1);
  truthy(an.error || an.data.length === 0, "signed-out can't read prefs");
  truthy((await save(A, A.id, "letters")).error, "only numbers/chords allowed");
} catch (e) {
  fail(`crashed: ${e.message ?? e}`);
} finally {
  for (const u of users) await svc.auth.admin.deleteUser(u.id);
}
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll prefs checks passed");
process.exit(failed ? 1 : 0);
