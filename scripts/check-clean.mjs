// Blocker check for "clean AI drafts: approve as is" against the real database.
// Creates throwaway songs with AI charts and two throwaway users, checks the clean rule
// (zero unclear + 75%+), the trigger mark, that nothing becomes Verified, admin-only
// reads, the queue filter and order, and undo; then deletes them all.
// Run: npm run check:clean   (needs SUPABASE_SERVICE_ROLE_KEY)
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
  const email = `clean-check-${tag}-${stamp}@example.com`;
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
const songIds = [];
// A live, never-verified song whose current chart is an AI reading.
async function aiSong(tag, confidence, unclear) {
  const s = await svc.from("songs").insert({ slug: `clean-check-${tag}-${stamp}`, title: `Clean Check ${tag} ${stamp}`, artist: "Check", status: "published" }).select("id").single();
  if (s.error) throw s.error;
  songIds.push(s.data.id);
  const notes = Array.from({ length: unclear }, (_, i) => `# UNCLEAR: bar ${i + 1}`).join("\n");
  const chart = `{title: Clean Check ${tag} ${stamp}}\n{key: G}\n\n${notes ? notes + "\n" : ""}[V] 1 4 5 1\n`;
  const r = await svc.from("revisions").insert({ song_id: s.data.id, chart_text: chart, source: "ai", ai_confidence: confidence, note: "check" }).select("id").single();
  if (r.error) throw r.error;
  await svc.from("songs").update({ current_revision_id: r.data.id }).eq("id", s.data.id);
  return { id: s.data.id, rev: r.data.id };
}
const marked = async (rev) => (await svc.from("approved_as_is").select("id, approved_by, undone_at").eq("revision_id", rev)).data ?? [];
const approve = (song) => svc.from("auto_approvals").insert({ song_id: song.id, revision_id: song.rev, approved_by: "auto", confidence: 0.9, cutoff: 0.65 });

try {
  const clean = await aiSong("clean", 0.8, 0);
  const edge = await aiSong("edge", 0.75, 0);
  const low = await aiSong("low", 0.74, 0);
  const messy = await aiSong("messy", 0.95, 1);
  const [ADM, P] = await Promise.all(["admin", "player"].map(makeUser));
  users.push(ADM, P);
  await svc.from("profiles").update({ role: "admin" }).eq("id", ADM.id);

  // ── the rule, through the auto-approve trigger ──
  for (const s of [clean, edge, low, messy]) ok(await approve(s), "auto-approval recorded");
  truthy((await marked(clean.rev)).length === 1, "clean (80%, 0 unclear) is marked approved-as-is");
  truthy((await marked(edge.rev))[0]?.approved_by === "auto", "exactly 75% counts, approver 'auto'");
  truthy((await marked(low.rev)).length === 0, "74% is not clean");
  truthy((await marked(messy.rev)).length === 0, "one unclear bar is not clean");
  const v = await svc.from("songs").select("verified_at, unverified").in("id", [clean.id, edge.id]);
  truthy(v.data?.every((r) => r.verified_at === null && r.unverified === true), "nothing became Verified");

  // ── who can see the mark ──
  const pr = await P.db.from("approved_as_is").select("id").in("revision_id", [clean.rev]);
  truthy(!pr.error && pr.data.length === 0, "players can't read approved-as-is");
  const an = await anon.from("approved_as_is").select("id").limit(1);
  truthy(an.error || an.data.length === 0, "signed-out can't read approved-as-is");
  const ar = await ADM.db.from("approved_as_is").select("id").eq("revision_id", clean.rev);
  truthy(ar.data?.length === 1, "admins can read it");
  truthy((await P.db.rpc("clean_plan")).error, "players can't run the plan");
  truthy((await ADM.db.rpc("clean_mark", { p_run: "x", p_ids: [] })).error, "browser can't run the pass (service role only)");

  // ── queue: filter and order ──
  const list = await ADM.db.rpc("review_list", { p_filter: "unverified", p_order: "confirmed", p_q: `Clean Check`, p_limit: 50, p_offset: 0 });
  ok(list, "review queue loads");
  const mine = (list.data?.songs ?? []).filter((s) => s.title.endsWith(String(stamp)));
  const firstClean = mine.findIndex((s) => s.clean);
  truthy(mine.length === 4 && firstClean === 2 && mine.slice(2).every((s) => s.clean), "clean charts sort after the ones needing checks");
  const cf = await ADM.db.rpc("review_list", { p_filter: "clean", p_order: "confirmed", p_q: `Clean Check`, p_limit: 50, p_offset: 0 });
  const cmine = (cf.data?.songs ?? []).filter((s) => s.title.endsWith(String(stamp)));
  truthy(cmine.length === 2 && typeof cf.data?.counts?.clean === "number", "Clean filter lists only clean charts, with a count");

  // ── sent back to review: no longer approved as is ──
  await svc.from("auto_approvals").update({ pulled_back_at: new Date().toISOString() }).eq("revision_id", edge.rev);
  truthy((await marked(edge.rev)).every((r) => r.undone_at !== null), "sending a chart back clears its mark");

  // ── a new revision isn't clean any more ──
  const r2 = await svc.from("revisions").insert({ song_id: clean.id, chart_text: `{title: x}\n{key: G}\n\n[V] 1 1 1 1\n`, source: "human", note: "edit" }).select("id").single();
  await svc.from("songs").update({ current_revision_id: r2.data.id }).eq("id", clean.id);
  const after = await ADM.db.rpc("review_list", { p_filter: "clean", p_order: "confirmed", p_q: `Clean Check clean ${stamp}`, p_limit: 50, p_offset: 0 });
  truthy((after.data?.songs ?? []).length === 0, "an edited chart drops out of Clean");

  // ── one-time pass: plan, mark, undo ──
  const live = await aiSong("live", 0.9, 0); // clean, live, never auto-approved
  const plan = await svc.rpc("clean_plan").eq("song_id", live.id);
  truthy(plan.data?.[0]?.bucket === "mark_live", "plan puts an unmarked clean live chart in mark_live");
  const run = `clean-check-${stamp}`;
  const m = await svc.rpc("clean_mark", { p_run: run, p_ids: [live.id, low.id] });
  truthy(m.data === 1, "pass marks only the clean one");
  truthy((await svc.rpc("clean_undo", { p_run: run, p_dry_run: true })).data === 1, "undo dry run counts it, changes nothing");
  truthy((await marked(live.rev)).every((r) => r.undone_at === null), "still marked after the dry run");
  truthy((await svc.rpc("clean_undo", { p_run: run, p_dry_run: false })).data === 1, "undo clears the run's mark");
  truthy((await marked(live.rev)).every((r) => r.undone_at !== null), "mark cleared");
  truthy((await svc.rpc("clean_mark", { p_run: run, p_ids: [live.id] })).data === 1, "re-runnable after undo");
} catch (e) {
  fail(`crashed: ${e.message ?? e}`);
} finally {
  for (const id of songIds) await svc.from("songs").delete().eq("id", id);
  for (const u of users) await svc.auth.admin.deleteUser(u.id);
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll clean-draft checks passed");
process.exit(failed ? 1 : 0);
