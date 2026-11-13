// Blocker check for AI reading (no Anthropic calls, nothing billed). Creates two throwaway
// users (contributor + admin) and two fake import rows, then checks: only admins reach the
// ai_* functions; the spend cap holds; a file is never reserved twice; the database's
// lyrics guard; a good result becomes an 'ai' revision on a hidden needs_review song.
// Deletes everything it made.
// Run: npm run check:ai   (needs the Supabase keys incl. SUPABASE_SERVICE_ROLE_KEY)
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
const expectErr = (r, m) => (r.error ? pass(`${m} (${r.error.code})`) : fail(`${m}: NOT blocked`));
const expectNone = (r, m) => (r.error || r.data.length === 0 ? pass(m) : fail(`${m}: saw ${r.data.length} row(s)`));

async function makeUser(tag) {
  const email = `ai-check-${tag}-${Date.now()}@example.com`;
  const created = await svc.auth.admin.createUser({ email, email_confirm: true });
  if (created.error) throw created.error;
  const link = await svc.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  const db = createClient(url, anonKey, opts);
  const v = await db.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
  if (v.error) throw v.error;
  return { id: created.data.user.id, db };
}

const Z = "00000000-0000-0000-0000-000000000000";
const users = [];
const files = [];
const tag = Date.now();
try {
  const c = await makeUser("contrib");
  users.push(c);
  const a = await makeUser("admin");
  users.push(a);
  const promote = await svc.from("profiles").update({ role: "admin" }).eq("id", a.id);
  if (promote.error) throw promote.error;

  // ── nobody but admins ──
  const calls = {
    ai_overview: {},
    ai_candidates: {},
    ai_reserve: { p_items: [], p_mode: "pilot", p_model: "x", p_cap: 1 },
    ai_reserve_more: { p_id: Z, p_est: 0.1, p_cap: 1 },
    ai_mark_submitted: { p_ids: [Z], p_batch_id: "b" },
    ai_release: { p_ids: [Z], p_error: "x" },
    ai_finish: { p_id: Z, p_status: "error", p_result: {} },
    ai_expire_stale: {},
    ai_approve_pilot: {},
  };
  for (const [who, db] of [["anon", anon], ["contributor", c.db]]) {
    for (const [fn, args] of Object.entries(calls)) expectErr(await db.rpc(fn, args), `${who} ${fn} blocked`);
    expectNone(await db.from("ai_readings").select("id").limit(1), `${who} can't read ai_readings`);
    expectNone(await db.from("ai_state").select("id").limit(1), `${who} can't read ai_state`);
    expectErr(await db.from("ai_readings").insert({ content_hash: "x", import_file_id: Z, mode: "pilot", model: "x" }), `${who} can't insert ai_readings`);
  }
  for (const fn of ["ai_spent", "ai_readable"]) {
    expectErr(await a.db.rpc(fn, fn === "ai_readable" ? { p_hash: "x" } : {}), `admin can't call internal ${fn}`);
  }
  expectErr(await a.db.from("ai_readings").insert({ content_hash: "x", import_file_id: Z, mode: "pilot", model: "x" }), "admin can't insert ai_readings directly");

  const ov = await a.db.rpc("ai_overview");
  if (ov.error) throw new Error(`admin ai_overview: ${ov.error.message}`);
  pass(`admin ai_overview works (spent $${Number(ov.data.spent).toFixed(2)}, ${ov.data.remaining} to read)`);
  const base = Number(ov.data.spent) + Number(ov.data.reserved); // real spend so far

  // ── fake files (service role) ──
  for (const n of [1, 2]) {
    const ins = await svc
      .from("import_files")
      .insert({
        dropbox_path: `/__ai-check__/${tag}-${n}.pdf`,
        file_name: `Ai Check ${tag} ${n} - Check Band.pdf`,
        content_hash: `ai-check-${tag}-${n}`,
        title: `Ai Check ${tag} ${n}`,
        artist: "Check Band",
        size_bytes: 1000,
      })
      .select("id")
      .single();
    if (ins.error) throw ins.error;
    files.push(ins.data.id);
  }
  const item = (id) => [{ import_file_id: id, est_usd: 1 }];

  if (!ov.data.pilot_approved_at) {
    expectErr(await a.db.rpc("ai_reserve", { p_items: item(files[0]), p_mode: "batch", p_model: "m", p_cap: base + 10 }), "full batch refused before the pilot is approved");
  }

  // ── the cap ──
  const over = await a.db.rpc("ai_reserve", { p_items: item(files[0]), p_mode: "pilot", p_model: "m", p_cap: base + 0.5 });
  check(!over.error && over.data.capped && over.data.reserved.length === 0, "reservation over the cap is refused");
  expectErr(await a.db.rpc("ai_reserve", { p_items: item(files[0]), p_mode: "pilot", p_model: "m", p_cap: 0 }), "no cap = nothing may be spent");

  // ── reserve once, never twice ──
  const r1 = await a.db.rpc("ai_reserve", { p_items: item(files[0]), p_mode: "pilot", p_model: "m", p_cap: base + 1.5 });
  check(!r1.error && r1.data.reserved.length === 1, "reservation under the cap works");
  const id1 = r1.data?.reserved[0]?.reading_id;
  const again = await a.db.rpc("ai_reserve", { p_items: item(files[0]), p_mode: "pilot", p_model: "m", p_cap: base + 10 });
  check(!again.error && again.data.reserved.length === 0 && again.data.skipped === 1, "same file can't be reserved twice");
  const more = await a.db.rpc("ai_reserve_more", { p_id: id1, p_est: 1, p_cap: base + 1.5 });
  check(!more.error && more.data === false, "retry reservation over the cap is refused");

  // ── lyrics guard in the database ──
  const lyric = '{title: T}\n{key: C}\n[V] 1 "and I will always love you baby" 4\n';
  const f1 = await a.db.rpc("ai_finish", { p_id: id1, p_status: "ok", p_result: { chart_text: lyric, cost_usd: 0.01, confidence: 0.9 } });
  check(!f1.error && f1.data === "needs_manual", "database turns a long-cue chart into needs_manual");
  const row1 = await svc.from("ai_readings").select("revision_id, cost_usd, reserved_usd").eq("id", id1).single();
  check(!row1.data.revision_id && Number(row1.data.cost_usd) === 0.01 && Number(row1.data.reserved_usd) === 0, "no revision; cost recorded, reservation released");
  const after = await a.db.rpc("ai_reserve", { p_items: item(files[0]), p_mode: "pilot", p_model: "m", p_cap: base + 10 });
  check(!after.error && after.data.reserved.length === 0, "billed file is never reserved again");

  // ── unbilled failure can be retried; good result → hidden needs_review song ──
  const r2 = await a.db.rpc("ai_reserve", { p_items: item(files[1]), p_mode: "pilot", p_model: "m", p_cap: base + 10 });
  const id2 = r2.data?.reserved[0]?.reading_id;
  await a.db.rpc("ai_release", { p_ids: [id2], p_error: "download failed" });
  const r3 = await a.db.rpc("ai_reserve", { p_items: item(files[1]), p_mode: "pilot", p_model: "m", p_cap: base + 10 });
  check(!r3.error && r3.data.reserved[0]?.reading_id === id2, "unbilled error is reserved again (same row)");
  const good = "{title: Ai Check}\n{key: G}\n{bpm: 120}\n[V] 1 4 5 1\n";
  const f2 = await a.db.rpc("ai_finish", {
    p_id: id2,
    p_status: "ok",
    p_result: { chart_text: good, cost_usd: 0.02, confidence: 0.81, raw: { chart_text: good, notes: "" }, unclear: [] },
  });
  check(!f2.error && f2.data === "ok", "good result saved");
  const twice = await a.db.rpc("ai_finish", { p_id: id2, p_status: "error", p_result: { cost_usd: 5 } });
  check(!twice.error && twice.data === "ok", "finishing twice is a no-op");
  const imp = await svc.from("import_files").select("song_id, status").eq("id", files[1]).single();
  const song = await svc.from("songs").select("id, slug, status, key, bpm, current_revision_id").eq("id", imp.data.song_id).single();
  check(song.data?.status === "needs_review" && imp.data.status === "needs_review", "song and import row are needs_review");
  check(song.data?.key === "G" && song.data?.bpm === 120, "key and bpm copied from the chart");
  const rev = await svc.from("revisions").select("source, ai_confidence, ai_raw, chart_text").eq("id", song.data.current_revision_id).single();
  check(rev.data?.source === "ai" && Number(rev.data.ai_confidence) === 0.81 && rev.data.ai_raw?.chart_text === good, "revision is source ai with confidence and raw output");
  expectNone(await anon.from("songs").select("id").eq("id", song.data.id), "anon can't see the needs_review song");
  expectNone(await anon.from("revisions").select("id").eq("id", song.data.current_revision_id), "anon can't see its AI revision");
} finally {
  if (files.length) {
    const songs = await svc.from("import_files").select("song_id").in("id", files);
    await svc.from("ai_readings").delete().in("import_file_id", files);
    const ids = (songs.data ?? []).map((s) => s.song_id).filter(Boolean);
    if (ids.length) await svc.from("songs").delete().in("id", ids);
    await svc.from("import_files").delete().in("id", files);
  }
  for (const u of users) await svc.auth.admin.deleteUser(u.id);
  console.log(`cleaned up ${users.length} test user(s) and ${files.length} fake file(s)`);
}
if (failed) {
  console.log(`${failed} check(s) FAILED`);
  process.exit(1);
}
console.log("all AI checks passed");
