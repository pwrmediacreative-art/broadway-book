// Blocker check for the full AI batch (no Anthropic calls, nothing billed). Uses a
// throwaway admin and fake import rows, and checks: pilot songs are never offered or
// reserved again; a sent file isn't sent again on resume; the first chunk stops the run
// until it's checked; the cap stops it; a technical failure is re-sent once, then
// needs_manual; "Retry failed" touches only failed files; a changed PDF is read again;
// nothing is published. Restores ai_state and deletes everything it made.
// Run: npm run check:batch   (needs the Supabase keys incl. SUPABASE_SERVICE_ROLE_KEY)
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
const expectErr = (r, m) => (r.error ? pass(`${m} (${r.error.message})`) : fail(`${m}: NOT blocked`));

async function makeAdmin() {
  const email = `ai-batch-check-${Date.now()}@example.com`;
  const created = await svc.auth.admin.createUser({ email, email_confirm: true });
  if (created.error) throw created.error;
  const id = created.data.user.id;
  const promote = await svc.from("profiles").update({ role: "admin" }).eq("id", id);
  if (promote.error) throw promote.error;
  const link = await svc.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  const db = createClient(url, anonKey, opts);
  const v = await db.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
  if (v.error) throw v.error;
  return { id, db };
}

const tag = Date.now();
const files = [];
let admin = null;
let savedState = null;
try {
  const st = await svc.from("ai_state").select("*").single();
  if (st.error) throw st.error;
  const realBatch = await svc.from("ai_readings").select("id", { count: "exact", head: true }).eq("mode", "batch");
  if ((realBatch.count ?? 0) > 0) throw new Error("A real full batch has started; this check would disturb its first-chunk gate. Not run.");
  const realOpen = await svc.from("ai_readings").select("id", { count: "exact", head: true }).in("status", ["reserved", "submitted"]);
  if ((realOpen.count ?? 0) > 0) throw new Error("A real AI run is in progress. Not run.");
  savedState = st.data;

  admin = await makeAdmin();
  const a = admin.db;
  for (const fn of ["ai_retry_failed", "ai_confirm_first_chunk"]) expectErr(await anon.rpc(fn), `anon ${fn} blocked`);
  expectErr(await a.rpc("ai_retryable"), "admin can't call internal ai_retryable");

  const ov0 = await a.rpc("ai_overview");
  if (ov0.error) throw new Error(ov0.error.message);
  const realRetryable = Number(ov0.data.retryable);
  console.log(
    `real data: ${ov0.data.remaining} to read · skipped ${JSON.stringify(ov0.data.skipped)} · spent $${Number(ov0.data.spent).toFixed(4)}`,
  );
  const base = Number(ov0.data.spent) + Number(ov0.data.reserved);
  const cap = base + 50;

  // The full batch needs an approved pilot; approve it for this check only (restored below).
  const ap = await a.rpc("ai_approve_pilot");
  check(!ap.error && ap.data, `"Approve pilot" works${ap.error ? ": " + ap.error.message : ""}`);

  // ── pilot songs are never offered or reserved again ──
  const pilot = await svc.from("ai_readings").select("import_file_id, content_hash").eq("mode", "pilot");
  const pilotFiles = (pilot.data ?? []).map((p) => p.import_file_id);
  const pilotHashes = (pilot.data ?? []).map((p) => p.content_hash);
  const cands = await a.rpc("ai_candidates");
  if (cands.error) throw new Error(cands.error.message);
  const copies = await svc.from("import_files").select("id").in("content_hash", pilotHashes);
  const pilotAll = (copies.data ?? []).map((f) => f.id); // the pilot files and any copies of their PDFs
  const offered = new Set(cands.data.map((c) => c.id));
  const pilotOffered = pilotAll.filter((id) => offered.has(id));
  check(pilotFiles.length > 0 && pilotOffered.length === 0, `none of the ${pilotAll.length} files with a pilot PDF are offered to the full batch`);
  if (pilotOffered.length === 0) {
    const r = await a.rpc("ai_reserve", {
      p_items: pilotAll.map((id) => ({ import_file_id: id, est_usd: 0.2 })),
      p_mode: "batch",
      p_model: "m",
      p_cap: cap,
    });
    check(!r.error && r.data.reserved.length === 0 && r.data.skipped === pilotAll.length, "reserving the pilot files again reserves none");
  }

  // ── fake files ──
  for (const n of [1, 2, 3, 4, 5]) {
    const ins = await svc
      .from("import_files")
      .insert({
        dropbox_path: `/__ai-batch-check__/${tag}-${n}.pdf`,
        file_name: `Batch Check ${tag} ${n} - Check Band.pdf`,
        content_hash: `ai-batch-check-${tag}-${n}`,
        title: `Batch Check ${tag} ${n}`,
        artist: "Check Band",
        size_bytes: 1000,
      })
      .select("id")
      .single();
    if (ins.error) throw ins.error;
    files.push(ins.data.id);
  }
  const [F1, F2, F3, F4, F5] = files;
  const item = (ids) => ids.map((id) => ({ import_file_id: id, est_usd: 0.2 }));
  const reserve = (ids, c = cap) => a.rpc("ai_reserve", { p_items: item(ids), p_mode: "batch", p_model: "m", p_cap: c });
  const offeredNow = async () => new Set(((await a.rpc("ai_candidates")).data ?? []).map((c) => c.id));
  const reading = async (fileId) => (await svc.from("ai_readings").select("*").eq("import_file_id", fileId).single()).data;
  const good = (t) => ({ chart_text: `{title: ${t}}\n{key: A}\n[V] 1 4 5 1\n`, cost_usd: 0.02, confidence: 0.8, raw: { notes: "" }, unclear: [] });

  // ── first chunk, then the gate ──
  const r1 = await reserve([F1]);
  check(!r1.error && r1.data.reserved.length === 1, "first chunk reserved");
  const id1 = r1.data?.reserved[0]?.reading_id;
  await a.rpc("ai_mark_submitted", { p_ids: [id1], p_batch_id: `check-${tag}` });
  check(!(await offeredNow()).has(F1), "a file in a running batch isn't offered again (resume doesn't repeat it)");
  expectErr(await reserve([F2]), "the rest waits until the first chunk is checked");
  expectErr(await a.rpc("ai_confirm_first_chunk"), "can't confirm while the first chunk is still out");
  const f1 = await a.rpc("ai_finish", { p_id: id1, p_status: "ok", p_result: good("One") });
  check(!f1.error && f1.data === "ok", "first chunk result saved");
  const imp = await svc.from("import_files").select("song_id, status").eq("id", F1).single();
  const song = await svc.from("songs").select("id, status, current_revision_id").eq("id", imp.data.song_id).single();
  const rev = await svc.from("revisions").select("source").eq("id", song.data.current_revision_id).single();
  check(song.data.status === "needs_review" && rev.data.source === "ai", "result is an ai revision on a needs_review song (not published)");
  const seen = await anon.from("songs").select("id").eq("id", song.data.id);
  check(!seen.error && seen.data.length === 0, "the public can't see it");
  const c1 = await a.rpc("ai_confirm_first_chunk");
  check(!c1.error && c1.data, `first chunk confirmed${c1.error ? ": " + c1.error.message : ""}`);

  // ── resume never repeats a finished file ──
  const r2 = await reserve([F1, F2]);
  check(
    !r2.error && r2.data.skipped === 1 && r2.data.reserved.length === 1 && r2.data.reserved[0].import_file_id === F2,
    "Resume skips the finished file and sends the next",
  );
  const id2 = r2.data?.reserved[0]?.reading_id;

  // ── technical failure (not billed): one re-send, then needs_manual ──
  await a.rpc("ai_release", { p_ids: [id2], p_error: "download failed" });
  let row = await reading(F2);
  check(row.status === "error" && row.failures === 1 && (await offeredNow()).has(F2), "first download failure: offered again once");
  const r3 = await reserve([F2]);
  check(!r3.error && r3.data.reserved[0]?.reading_id === id2, "re-sent on the same row");
  await a.rpc("ai_release", { p_ids: [id2], p_error: "download failed" });
  row = await reading(F2);
  const imp2 = await svc.from("import_files").select("status").eq("id", F2).single();
  check(
    row.status === "needs_manual" && imp2.data.status === "needs_manual" && !(await offeredNow()).has(F2),
    "second failure: needs_manual, not sent again",
  );

  const id3 = (await reserve([F3])).data?.reserved[0]?.reading_id;
  await a.rpc("ai_mark_submitted", { p_ids: [id3], p_batch_id: `check-${tag}` });
  const e1 = await a.rpc("ai_finish", { p_id: id3, p_status: "error", p_result: { error: "Batch expired", cost_usd: 0 } });
  check(e1.data === "error" && (await offeredNow()).has(F3), "batch error (not billed): offered again once");
  const id3b = (await reserve([F3])).data?.reserved[0]?.reading_id;
  const e2 = await a.rpc("ai_finish", { p_id: id3b, p_status: "error", p_result: { error: "Batch expired", cost_usd: 0 } });
  check(e2.data === "needs_manual" && !(await offeredNow()).has(F3), "second batch error: needs_manual");

  // ── billed, no chart: needs_manual, never sent again on its own ──
  const id4 = (await reserve([F4])).data?.reserved[0]?.reading_id;
  const n4 = await a.rpc("ai_finish", { p_id: id4, p_status: "needs_manual", p_result: { error: "cut off", cost_usd: 0.03 } });
  check(n4.data === "needs_manual" && !(await offeredNow()).has(F4), "billed failure is not re-sent on its own");

  // ── the cap stops the run ── (spent so far in this check: 0.02 + 0.03)
  const capped = await reserve([F5], base + 0.05 + 0.1);
  check(!capped.error && capped.data.capped && capped.data.reserved.length === 0, "over the cap: nothing reserved, run reports capped");

  // ── Retry failed touches only failed files ──
  const ov1 = (await a.rpc("ai_overview")).data;
  check(Number(ov1.retryable) === realRetryable + 3, `Retry failed would touch the 3 failed fake files (${ov1.retryable} total)`);
  if (realRetryable === 0) {
    const q = await a.rpc("ai_retry_failed");
    check(!q.error && q.data === 3, "Retry failed queued exactly 3");
    const offered2 = await offeredNow();
    check(offered2.has(F2) && offered2.has(F3) && offered2.has(F4) && !offered2.has(F1), "queued failed files are offered; the done file isn't");
    const okRow = await reading(F1);
    check(!okRow.queued && okRow.status === "ok", "the done reading is untouched");
    const id4b = (await reserve([F4])).data?.reserved[0]?.reading_id;
    row = await reading(F4);
    check(id4b === id4 && row.admin_retries === 1 && !row.queued, "retry re-uses the row and counts the retry");
    const rf = await a.rpc("ai_finish", { p_id: id4b, p_status: "refused", p_result: { error: "Refused", cost_usd: 0.01 } });
    row = await reading(F4);
    check(rf.data === "needs_manual" && Math.abs(Number(row.cost_usd) - 0.04) < 1e-9, "fails again after Retry failed: needs_manual, both costs counted");
    const ov2 = (await a.rpc("ai_overview")).data;
    check(Number(ov2.queued) === 2, "the other two stay queued for the next run");
  } else {
    console.log(`SKIP Retry failed queue test: ${realRetryable} real failed file(s) would be queued`);
  }

  // ── a changed PDF is read again ──
  await svc.from("import_files").update({ content_hash: `ai-batch-check-${tag}-1-changed` }).eq("id", F1);
  check((await offeredNow()).has(F1), "a file whose PDF changed is offered again");
} finally {
  if (files.length) {
    const songs = await svc.from("import_files").select("song_id").in("id", files);
    await svc.from("ai_readings").delete().in("import_file_id", files);
    const ids = (songs.data ?? []).map((s) => s.song_id).filter(Boolean);
    if (ids.length) await svc.from("songs").delete().in("id", ids);
    await svc.from("import_files").delete().in("id", files);
  }
  if (savedState) {
    const r = await svc
      .from("ai_state")
      .update({
        pilot_approved_at: savedState.pilot_approved_at,
        pilot_approved_by: savedState.pilot_approved_by,
        first_chunk_ok_at: savedState.first_chunk_ok_at,
        first_chunk_ok_by: savedState.first_chunk_ok_by,
      })
      .eq("id", true);
    if (r.error) fail(`ai_state not restored: ${r.error.message}`);
  }
  if (admin) await svc.auth.admin.deleteUser(admin.id);
  console.log(`cleaned up ${files.length} fake file(s); ai_state restored`);
}
if (failed) {
  console.log(`${failed} check(s) FAILED`);
  process.exit(1);
}
console.log("all full-batch checks passed");
