// Blocker check: anonymous users can read published songs (and their history and suggestions)
// but can't write anything or see private data.
// Run: node --env-file=.env.local scripts/check-rls.mjs   (or with env vars set)
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
const db = createClient(url, key, { auth: { persistSession: false } });
const fakeId = "00000000-0000-0000-0000-000000000000";

let failed = 0;
const pass = (m) => console.log("PASS", m);
const fail = (m) => { failed++; console.log("FAIL", m); };

// Reads
const songs = await db.from("songs").select("id, status, current_revision_id");
if (songs.error) fail(`read songs: ${songs.error.message}`);
else if (songs.data.length && songs.data.every((s) => s.status === "published")) pass(`anon reads ${songs.data.length} published songs only`);
else fail(`anon songs read: ${JSON.stringify(songs.data)}`);

// Revision history and suggestions are public, but only for published songs.
const published = new Set((songs.data ?? []).map((s) => s.id));
const revs = await db.from("revisions").select("id, song_id");
if (!revs.error && revs.data.every((r) => published.has(r.song_id))) pass(`anon reads revisions of published songs only (${revs.data.length})`);
else fail(`revisions read: ${revs.error?.message ?? "revision of an unpublished song visible"}`);
const props = await db.from("proposals").select("id, song_id");
if (!props.error && props.data.every((p) => published.has(p.song_id))) pass(`anon reads suggestions of published songs only (${props.data.length})`);
else fail(`proposals read: ${props.error?.message ?? "suggestion on an unpublished song visible"}`);

for (const t of ["import_files", "personal_chart_versions", "notifications", "reports"]) {
  const r = await db.from(t).select("*").limit(1);
  if (r.error || r.data.length === 0) pass(`anon can't read ${t}`);
  else fail(`anon read ${t}`);
}

// Writes
const firstSong = songs.data?.[0]?.id ?? fakeId;
const writes = {
  songs: { slug: "rls-test", title: "RLS test", status: "published" },
  revisions: { song_id: firstSong, chart_text: "x", source: "human" },
  proposals: { song_id: firstSong, chart_text: "x", author_id: fakeId },
  votes: { proposal_id: fakeId, voter_id: fakeId, value: "approve" },
  profiles: { id: fakeId },
  setlists: { name: "x", owner_id: fakeId },
  setlist_items: { setlist_id: fakeId, song_id: firstSong, position: 1 },
  import_files: { dropbox_path: "/x.pdf" },
  personal_chart_versions: { user_id: fakeId, song_id: firstSong, chart_text: "x" },
  notifications: { user_id: fakeId, kind: "merged" },
  reports: { reporter_id: fakeId, proposal_id: fakeId, reason: "spam" },
  settings: { key: "x", value: 1, label: "x" },
};
for (const [t, row] of Object.entries(writes)) {
  const r = await db.from(t).insert(row).select();
  if (r.error) pass(`anon insert ${t} blocked (${r.error.code})`);
  else fail(`anon INSERTED into ${t}: ${JSON.stringify(r.data)}`);
}
const upd = await db.from("songs").update({ title: "hacked" }).eq("id", firstSong).select();
if (upd.error || upd.data.length === 0) pass("anon update songs blocked");
else fail("anon UPDATED a song");
const del = await db.from("songs").delete().eq("id", firstSong).select();
if (del.error || del.data.length === 0) pass("anon delete songs blocked");
else fail("anon DELETED a song");
const rpc = await db.rpc("revert_song", { p_song_id: firstSong, p_revision_id: fakeId });
if (rpc.error) pass(`anon revert_song blocked (${rpc.error.code})`);
else fail("anon called revert_song");
const setUpd = await db.from("settings").update({ value: 1 }).eq("key", "approvals_needed").select();
if (setUpd.error || setUpd.data.length === 0) pass("anon update settings blocked");
else fail("anon UPDATED settings");
for (const fn of ["publish_chart", "decide_proposal", "admin_decide", "set_setting", "set_blocked", "update_proposal", "withdraw_proposal"]) {
  const r = await db.rpc(fn, {});
  if (r.error) pass(`anon ${fn} blocked (${r.error.code})`);
  else fail(`anon called ${fn}`);
}

console.log(failed ? `\n${failed} RLS check(s) FAILED` : "\nAll RLS checks passed");
process.exit(failed ? 1 : 0);
