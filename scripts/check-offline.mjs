// Blocker check for the offline step (database: offline_sync + the songs_touch trigger).
// Reads as a signed-out visitor; makes one throwaway draft song to test the trigger, then deletes it.
// Run: npm run check:offline   (needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const svc = createClient(url, serviceKey, opts);
const anon = createClient(url, anonKey, opts);

let failed = 0;
const check = (ok, m, detail) => {
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", detail && !ok ? `${m}: ${detail}` : m);
};
const sync = async (args) => {
  const r = await anon.rpc("offline_sync", args);
  if (r.error) throw new Error(`offline_sync: ${r.error.message}`);
  return r.data;
};

const slug = `offline-check-${Date.now()}`;
let songId = null;
try {
  // What a signed-out visitor can see today.
  const pub = await anon.from("songs").select("slug, current_revision_id").eq("status", "published");
  if (pub.error) throw pub.error;
  const expected = pub.data.filter((s) => s.current_revision_id).map((s) => s.slug).sort();

  const all = await sync({});
  check(all.total === expected.length, "total = published songs with a chart", `${all.total} vs ${expected.length}`);
  check(JSON.stringify([...all.slugs].sort()) === JSON.stringify(expected), "slug list = every published song");
  check(all.songs.length === Math.min(expected.length, 400), "first page holds the charts");
  check(all.songs.every((s) => typeof s.chart_text === "string" && s.chart_text.length > 0 && s.id && s.updated_at), "each row has id, chart text and updated_at");
  check(typeof all.now === "string" && !Number.isNaN(Date.parse(all.now)), "server time returned");

  // Paging: small pages cover every song once, in order, and only the first page lists slugs.
  const seen = [];
  let after = "";
  let pages = 0;
  for (;;) {
    const page = await sync({ p_after: after, p_limit: 2 });
    if (pages > 0) check(page.slugs === null, `page ${pages + 1} carries no slug list`);
    seen.push(...page.songs.map((s) => s.slug));
    pages++;
    if (page.songs.length < 2 || pages > 2000) break;
    after = page.songs[page.songs.length - 1].slug;
    if (pages >= 3 && expected.length > 6) break; // enough to prove paging without walking a big catalog
  }
  check(new Set(seen).size === seen.length, "paging never repeats a song");
  if (expected.length <= 6) check(seen.length === expected.length, "paging reaches every song", `${seen.length} of ${expected.length}`);

  // "Changed since": nothing is newer than the future; everything is newer than the distant past.
  const future = await sync({ p_since: new Date(Date.now() + 3600_000).toISOString() });
  check(future.songs.length === 0 && future.slugs.length === expected.length, "since (future): no charts, slug list still complete");
  const past = await sync({ p_since: "2000-01-01T00:00:00Z" });
  check(past.songs.length === Math.min(expected.length, 400), "since (long ago): all charts");

  // Trigger: updated_at moves on changes a player can see, not on bookkeeping.
  const made = await svc.from("songs").insert({ slug, title: "Offline check", status: "draft" }).select("id, updated_at").single();
  if (made.error) throw made.error;
  songId = made.data.id;
  const t0 = made.data.updated_at;
  await new Promise((r) => setTimeout(r, 50));
  const book = await svc.from("songs").update({ dropbox_content_hash: "offline-check" }).eq("id", songId).select("updated_at").single();
  check(!book.error && book.data.updated_at === t0, "bookkeeping change leaves updated_at alone", book.error?.message);
  const vis = await svc.from("songs").update({ title: "Offline check 2" }).eq("id", songId).select("updated_at").single();
  check(!vis.error && Date.parse(vis.data.updated_at) > Date.parse(t0), "title change moves updated_at", vis.error?.message);

  const after2 = await sync({});
  check(!after2.slugs.includes(slug) && !after2.songs.some((s) => s.slug === slug), "a draft song never reaches the phone");
} catch (e) {
  failed++;
  console.log("FAIL", e.message ?? e);
} finally {
  if (songId) {
    const del = await svc.from("songs").delete().eq("id", songId);
    console.log(del.error ? `CLEANUP FAILED: delete song ${slug} by hand (${del.error.message})` : "cleanup done");
  }
}
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll offline checks passed");
process.exit(failed ? 1 : 0);
