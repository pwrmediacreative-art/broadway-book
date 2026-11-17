// Remove the example/demo songs created during setup (songs.is_example = true) and
// everything that only exists for them.
//
//   npm run remove:demos               dry run: lists exactly what would be deleted, changes nothing
//   npm run remove:demos -- --apply    delete them
//
// Only songs with is_example = true are ever touched. Deleting a song cascades (see the
// foreign keys in supabase/migrations): its revisions, setlist entries in anyone's setlists,
// proposals (+ votes, reports, notifications), flags, confirmations, personal versions,
// redirects, renames, lyrics picks and review rows go with it. import_files keep their row
// with song_id set to null. The dry run counts each of those so nothing is a surprise.
// Needs SUPABASE_SERVICE_ROLE_KEY in .env.local (server only, never in the browser).
import { createClient } from "@supabase/supabase-js";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apply = process.argv.includes("--apply");
if (!URL_ || !KEY) {
  console.error("Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (run with --env-file=.env.local).");
  process.exit(1);
}
const db = createClient(URL_, KEY, { auth: { persistSession: false } });

/** Tables that point at songs.id. `cascade` = deleted with the song; `set null` = kept, link cleared. */
const BY_SONG: { table: string; column: string; effect: "cascade" | "set null" }[] = [
  { table: "revisions", column: "song_id", effect: "cascade" },
  { table: "setlist_items", column: "song_id", effect: "cascade" },
  { table: "proposals", column: "song_id", effect: "cascade" },
  { table: "notifications", column: "song_id", effect: "cascade" },
  { table: "personal_chart_versions", column: "song_id", effect: "cascade" },
  { table: "personal_flags", column: "song_id", effect: "cascade" },
  { table: "chart_flags", column: "song_id", effect: "cascade" },
  { table: "chart_confirmations", column: "song_id", effect: "cascade" },
  { table: "review_claims", column: "song_id", effect: "cascade" },
  { table: "review_drafts", column: "song_id", effect: "cascade" },
  { table: "review_log", column: "song_id", effect: "cascade" },
  { table: "verification_log", column: "song_id", effect: "cascade" },
  { table: "auto_approvals", column: "song_id", effect: "cascade" },
  { table: "approved_as_is", column: "song_id", effect: "cascade" },
  { table: "uploads", column: "song_id", effect: "cascade" },
  { table: "song_slug_redirects", column: "song_id", effect: "cascade" },
  { table: "song_renames", column: "song_id", effect: "cascade" },
  { table: "rename_proposals", column: "song_id", effect: "cascade" },
  { table: "lyrics_hidden", column: "song_id", effect: "cascade" },
  { table: "lyrics_picks", column: "song_id", effect: "cascade" },
  { table: "lyrics_log", column: "song_id", effect: "cascade" },
  { table: "import_files", column: "song_id", effect: "set null" },
];
/** Tables that point at proposals.id (the example songs' proposals cascade into these). */
const BY_PROPOSAL = ["votes", "reports", "notifications"];
/** Tables that point at revisions.id with "set null": rows stay, the link is cleared. */
const BY_REVISION = ["ai_readings"];

async function count(table: string, column: string, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const { count: n, error } = await db.from(table).select("*", { count: "exact", head: true }).in(column, ids);
  if (error) throw new Error(`${table}.${column}: ${error.message}`);
  return n ?? 0;
}

async function main() {
  const { data: songs, error } = await db
    .from("songs")
    .select("id, slug, title, artist, status, is_example")
    .eq("is_example", true)
    .order("slug");
  if (error) throw error;
  const list = (songs ?? []).filter((s) => s.is_example === true); // belt and braces: never a real song
  const ids = list.map((s) => s.id);
  const { count: total } = await db.from("songs").select("*", { count: "exact", head: true });

  console.log(`${apply ? "APPLY" : "DRY RUN"}: remove demo songs (is_example = true)`);
  console.log(`Run at ${new Date().toISOString()} against ${new URL(URL_!).host}`);
  console.log(`Songs in the database: ${total ?? "?"}; demo songs: ${list.length}; real songs untouched: ${(total ?? 0) - list.length}\n`);
  if (!list.length) {
    console.log("Nothing to delete.");
    return;
  }
  console.log("Demo songs:");
  for (const s of list) console.log(`  - ${s.slug}  "${s.title}"${s.artist ? ` by ${s.artist}` : ""}  [${s.status}]  id ${s.id}`);

  // A real song with the same title stays (it isn't is_example); list it so nobody mixes them up.
  for (const s of list) {
    const { data: twins } = await db.from("songs").select("slug, status").ilike("title", s.title).eq("is_example", false);
    if (twins?.length) console.log(`    kept: real song(s) with the same title: ${twins.map((t) => `${t.slug} [${t.status}]`).join(", ")}`);
  }

  console.log("\nRows that go with them:");
  for (const t of BY_SONG) {
    const n = await count(t.table, t.column, ids);
    console.log(`  ${t.table.padEnd(26)} ${String(n).padStart(5)}  ${t.effect === "cascade" ? "deleted" : "kept, song_id cleared"}`);
  }

  const { data: props } = await db.from("proposals").select("id").in("song_id", ids);
  const propIds = (props ?? []).map((p) => p.id);
  for (const t of BY_PROPOSAL) {
    const n = await count(t, "proposal_id", propIds);
    console.log(`  ${`${t} (via proposals)`.padEnd(26)} ${String(n).padStart(5)}  deleted`);
  }
  const { data: revs } = await db.from("revisions").select("id").in("song_id", ids);
  const revIds = (revs ?? []).map((r) => r.id);
  for (const t of BY_REVISION) {
    const n = await count(t, "revision_id", revIds);
    console.log(`  ${`${t} (via revisions)`.padEnd(26)} ${String(n).padStart(5)}  kept, revision_id cleared`);
  }

  // Setlists: deleting a song removes it from every setlist that has it. List each one.
  const { data: items, error: itemsErr } = await db
    .from("setlist_items")
    .select("setlist_id, song_id, setlist:setlists(name, owner_id, owner:profiles(display_name))")
    .in("song_id", ids);
  if (itemsErr) throw itemsErr;
  const per = new Map<string, { name: string; owner: string; n: number; songs: Set<string> }>();
  const slugOf = new Map(list.map((s) => [s.id, s.slug]));
  for (const it of (items ?? []) as unknown as {
    setlist_id: string;
    song_id: string;
    setlist: { name: string; owner_id: string; owner: { display_name: string | null } | null } | null;
  }[]) {
    const e = per.get(it.setlist_id) ?? {
      name: it.setlist?.name ?? "?",
      owner: it.setlist?.owner?.display_name || `user ${it.setlist?.owner_id?.slice(0, 8) ?? "?"}`,
      n: 0,
      songs: new Set<string>(),
    };
    e.n++;
    e.songs.add(slugOf.get(it.song_id) ?? it.song_id);
    per.set(it.setlist_id, e);
  }
  console.log(`\nSetlists that contain demo songs: ${per.size}`);
  for (const [id, e] of per)
    console.log(`  - "${e.name}" (owner: ${e.owner}, id ${id}): ${e.n} item${e.n === 1 ? "" : "s"} removed (${[...e.songs].join(", ")})`);

  if (!apply) {
    console.log("\nDry run only. Nothing was deleted. Run with --apply to delete exactly the songs above.");
    return;
  }
  const { data: gone, error: delErr } = await db.from("songs").delete().in("id", ids).eq("is_example", true).select("slug");
  if (delErr) throw delErr;
  console.log(`\nDeleted ${gone?.length ?? 0} demo songs: ${(gone ?? []).map((g) => g.slug).join(", ")}`);
  console.log("Phones drop them at the next offline sync; the search index rebuilds on its next refresh.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
